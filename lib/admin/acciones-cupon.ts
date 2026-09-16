"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { coupons, couponRedemptions } from "@/lib/db/schema";
import { ejecutar, exigirAdmin, type ResultadoAccion } from "@/lib/admin/guardia";
import { esquemaCupon, valorAColumna } from "@/lib/validaciones/cupon";

/**
 * Acciones del panel de cupones.
 *
 * Exigen rol de administración: un cupón mal puesto regala dinero. La UI solo
 * maneja cupones de alcance `orden`; el scope se fija aquí, no viaja del
 * formulario.
 *
 * Las fechas se guardan en UTC a partir de una fecha de Bogotá sin hora: el
 * inicio a las 00:00 y el fin al terminar el día (23:59:59), para que "válido
 * hasta el 14 de febrero" incluya ese día entero, como espera quien lo crea.
 */

function texto(datos: FormData, campo: string): string {
  const v = datos.get(campo);
  return typeof v === "string" ? v : "";
}

/** Fecha de Bogotá (AAAA-MM-DD) → instante UTC. `fin` toma el final del día. */
function aInstante(fecha: string | null, fin: boolean): Date | null {
  if (!fecha) return null;
  // Bogotá es UTC−5 todo el año (sin horario de verano): el offset es fijo.
  const hora = fin ? "23:59:59" : "00:00:00";
  return new Date(`${fecha}T${hora}-05:00`);
}

function leerFormulario(datos: FormData) {
  return esquemaCupon.safeParse({
    code: texto(datos, "code"),
    description: texto(datos, "description"),
    type: texto(datos, "type"),
    valorCrudo: texto(datos, "valorCrudo"),
    minSubtotalCop: texto(datos, "minSubtotalCop"),
    maxDiscountCop: texto(datos, "maxDiscountCop"),
    usageLimit: texto(datos, "usageLimit"),
    usageLimitPerUser: texto(datos, "usageLimitPerUser"),
    startsAt: texto(datos, "startsAt"),
    endsAt: texto(datos, "endsAt"),
    isActive: datos.get("isActive") === "on",
  });
}

function aColumnas(d: ReturnType<typeof esquemaCupon.parse>) {
  return {
    code: d.code,
    description: d.description,
    type: d.type,
    scope: "orden" as const,
    value: valorAColumna(d),
    minSubtotalCop: d.minSubtotalCop,
    // El tope de descuento solo tiene sentido para porcentaje.
    maxDiscountCop: d.type === "porcentaje" ? d.maxDiscountCop : null,
    usageLimit: d.usageLimit,
    usageLimitPerUser: d.usageLimitPerUser,
    startsAt: aInstante(d.startsAt, false),
    endsAt: aInstante(d.endsAt, true),
    isActive: d.isActive,
  };
}

function revalidar() {
  revalidatePath("/admin/cupones");
}

/** Traduce el choque del índice único de código a un mensaje claro. */
function esCodigoDuplicado(e: unknown): boolean {
  const causa = e && typeof e === "object" && "cause" in e ? e.cause : e;
  const codigo =
    causa && typeof causa === "object" && "code" in causa
      ? String((causa as { code: unknown }).code)
      : null;
  return codigo === "23505";
}

export async function crearCupon(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  let idNuevo: string | null = null;

  const resultado = await ejecutar("cupones/crear", async () => {
    await exigirAdmin();

    const analisis = leerFormulario(datos);
    if (!analisis.success) {
      return { ok: false, error: analisis.error.issues[0]?.message ?? "Revisa los campos." };
    }

    try {
      const [fila] = await db
        .insert(coupons)
        .values(aColumnas(analisis.data))
        .returning({ id: coupons.id });
      idNuevo = fila?.id ?? null;
    } catch (e) {
      if (esCodigoDuplicado(e)) {
        return { ok: false, error: "Ya existe un cupón con ese código." };
      }
      throw e;
    }

    return { ok: true };
  });

  if (resultado.ok && idNuevo) {
    revalidar();
    redirect(`/admin/cupones/${idNuevo}/`);
  }

  return resultado;
}

export async function guardarCupon(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("cupones/guardar", async () => {
    await exigirAdmin();

    const id = texto(datos, "id");
    if (!id) return { ok: false, error: "Falta el identificador del cupón." };

    const analisis = leerFormulario(datos);
    if (!analisis.success) {
      return { ok: false, error: analisis.error.issues[0]?.message ?? "Revisa los campos." };
    }

    try {
      const filas = await db
        .update(coupons)
        .set(aColumnas(analisis.data))
        .where(eq(coupons.id, id))
        .returning({ id: coupons.id });
      if (filas.length === 0) return { ok: false, error: "Ese cupón ya no existe." };
    } catch (e) {
      if (esCodigoDuplicado(e)) {
        return { ok: false, error: "Ya existe otro cupón con ese código." };
      }
      throw e;
    }

    revalidar();
    return { ok: true, mensaje: "Cupón guardado." };
  });
}

export async function alternarCupon(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("cupones/alternar", async () => {
    await exigirAdmin();

    const id = texto(datos, "id");
    const activar = datos.get("activar") === "true";
    if (!id) return { ok: false, error: "Falta el identificador." };

    await db.update(coupons).set({ isActive: activar }).where(eq(coupons.id, id));

    revalidar();
    return { ok: true, mensaje: activar ? "Cupón activado." : "Cupón desactivado." };
  });
}

/**
 * Los cupones NO se borran si ya se usaron: `coupon_redemptions` los referencia
 * y el historial de pedidos perdería el porqué de su descuento. Un cupón usado
 * se desactiva; solo se borra de verdad el que nunca cobró a nadie.
 */
export async function eliminarCupon(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  let borrado = false;

  const resultado = await ejecutar("cupones/eliminar", async () => {
    await exigirAdmin();

    const id = texto(datos, "id");
    if (!id) return { ok: false, error: "Falta el identificador." };

    const [{ usos }] = await db
      .select({ usos: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, id));

    if (usos > 0) {
      return {
        ok: false,
        error: "Este cupón ya se usó en pedidos. Desactívalo en vez de borrarlo, para no perder el historial.",
      };
    }

    await db.delete(coupons).where(eq(coupons.id, id));
    borrado = true;
    return { ok: true };
  });

  if (resultado.ok && borrado) {
    revalidar();
    redirect("/admin/cupones/");
  }

  return resultado;
}
