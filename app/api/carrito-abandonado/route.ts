import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { guardarCarritoAbandonado } from "@/lib/data/carrito-abandonado";
import { TIENDA } from "@/tienda.config";

/**
 * Guarda el carrito de quien escribió su correo en el checkout pero todavía no
 * confirmó. Lo llama el formulario en cuanto el correo es válido.
 *
 * Es fuego y olvido: si falla, el cliente no se entera y la compra sigue su
 * curso. Lo único que se pierde es el recordatorio.
 */

export const dynamic = "force-dynamic";

const esquema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Sin autorización explícita no se guarda nada: es dato personal con fin
  // comercial (Ley 1581/2012).
  consent: z.literal(true),
  subtotalCop: z.number().int().min(0).max(99_999_999),
  items: z
    .array(
      z.object({
        productoId: z.string().uuid(),
        varianteId: z.string().uuid().nullable(),
        slug: z.string().trim().max(200),
        nombre: z.string().trim().min(1).max(200),
        precioCop: z.number().int().min(0).max(99_999_999),
        imagenUrl: z.string().trim().max(500).nullable(),
        // Solo rutas internas: una URL ajena aquí acabaría dentro del correo.
        ruta: z.string().trim().max(300).startsWith("/"),
        cantidad: z.number().int().positive().max(TIENDA.checkout.maxUnidadesPorProducto),
      }),
    )
    .min(1)
    .max(40),
});

/** Mismo criterio anti-CSRF que /api/checkout. */
async function mismoOrigen(): Promise<boolean> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return false;
  const bruto = h.get("origin") ?? h.get("referer");
  if (!bruto) return false;
  try {
    return new URL(bruto).host === host;
  } catch {
    return false;
  }
}

export async function POST(peticion: Request) {
  if (!(await mismoOrigen())) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const analisis = esquema.safeParse(cuerpo);
  // Se responde 204 aunque los datos no sirvan: quien llama no hace nada con el
  // error y devolver detalles solo ayudaría a sondear el endpoint.
  if (!analisis.success) return new NextResponse(null, { status: 204 });

  try {
    await guardarCarritoAbandonado(analisis.data);
  } catch (e) {
    console.error(
      `carrito-abandonado: no se pudo guardar — ${e instanceof Error ? e.name : "desconocido"}`,
    );
  }

  return new NextResponse(null, { status: 204 });
}
