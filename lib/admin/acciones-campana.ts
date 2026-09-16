"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { ejecutar, exigirAdmin, type ResultadoAccion } from "@/lib/admin/guardia";
import { esquemaCampana } from "@/lib/validaciones/campana";

/**
 * Acciones del panel de campañas.
 *
 * Las campañas las administra la dueña, no quien programa: son la razón de que
 * `campaigns` sea una tabla y no texto en el repositorio. Encenderlas exige
 * rol de administración (mueven la portada entera de la tienda).
 *
 * La imagen que se guarda aquí es una RUTA del sitio (/campanas/...): se sube
 * aparte por el gestor de imágenes y aquí se referencia. El schema y el Zod la
 * validan como ruta interna.
 */

function texto(datos: FormData, campo: string): string {
  const v = datos.get(campo);
  return typeof v === "string" ? v : "";
}

function leerFormulario(datos: FormData) {
  return esquemaCampana.safeParse({
    nombre: texto(datos, "nombre"),
    titulo: texto(datos, "titulo"),
    cuerpo: texto(datos, "cuerpo"),
    imagenUrl: texto(datos, "imagenUrl"),
    imagenMovilUrl: texto(datos, "imagenMovilUrl"),
    imagenAlt: texto(datos, "imagenAlt"),
    colorFondo: texto(datos, "colorFondo"),
    ctaLabel: texto(datos, "ctaLabel"),
    ctaHref: texto(datos, "ctaHref"),
    inicio: texto(datos, "inicio"),
    fin: texto(datos, "fin"),
    activa: datos.get("activa") === "on",
  });
}

/** Mapea el resultado de Zod a las columnas de la tabla. */
function aColumnas(d: ReturnType<typeof esquemaCampana.parse>) {
  return {
    name: d.nombre,
    title: d.titulo,
    body: d.cuerpo,
    imageUrl: d.imagenUrl,
    imageMobileUrl: d.imagenMovilUrl,
    imageAlt: d.imagenAlt,
    backgroundColor: d.colorFondo,
    ctaLabel: d.ctaLabel,
    ctaHref: d.ctaHref,
    startsOn: d.inicio,
    endsOn: d.fin,
    enabled: d.activa,
  };
}

/**
 * La portada lee la campaña vigente sin caché (force-dynamic), así que no hace
 * falta invalidar nada del borde: el cambio se ve en la siguiente visita. Pero
 * la caché del router de Next sí guarda el HTML de /admin/campanas.
 */
function revalidar() {
  revalidatePath("/admin/campanas");
  revalidatePath("/");
}

export async function crearCampana(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  let idNueva: string | null = null;

  const resultado = await ejecutar("campanas/crear", async () => {
    await exigirAdmin();

    const analisis = leerFormulario(datos);
    if (!analisis.success) {
      return { ok: false, error: analisis.error.issues[0]?.message ?? "Revisa los campos." };
    }

    const [fila] = await db
      .insert(campaigns)
      .values(aColumnas(analisis.data))
      .returning({ id: campaigns.id });

    idNueva = fila?.id ?? null;
    return { ok: true };
  });

  if (resultado.ok && idNueva) {
    revalidar();
    // Fuera del try: redirect lanza una excepción de control de flujo que
    // `ejecutar` confundiría con un error.
    redirect(`/admin/campanas/${idNueva}/`);
  }

  return resultado;
}

export async function guardarCampana(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("campanas/guardar", async () => {
    await exigirAdmin();

    const id = texto(datos, "id");
    if (!id) return { ok: false, error: "Falta el identificador de la campaña." };

    const analisis = leerFormulario(datos);
    if (!analisis.success) {
      return { ok: false, error: analisis.error.issues[0]?.message ?? "Revisa los campos." };
    }

    const filas = await db
      .update(campaigns)
      .set(aColumnas(analisis.data))
      .where(eq(campaigns.id, id))
      .returning({ id: campaigns.id });

    if (filas.length === 0) return { ok: false, error: "Esa campaña ya no existe." };

    revalidar();
    return { ok: true, mensaje: "Campaña guardada." };
  });
}

/** Encender o apagar sin abrir la ficha: el interruptor de la lista. */
export async function alternarCampana(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("campanas/alternar", async () => {
    await exigirAdmin();

    const id = texto(datos, "id");
    const activar = datos.get("activar") === "true";
    if (!id) return { ok: false, error: "Falta el identificador." };

    await db.update(campaigns).set({ enabled: activar }).where(eq(campaigns.id, id));

    revalidar();
    return { ok: true, mensaje: activar ? "Campaña encendida." : "Campaña apagada." };
  });
}

export async function eliminarCampana(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  let borrada = false;

  const resultado = await ejecutar("campanas/eliminar", async () => {
    await exigirAdmin();

    const id = texto(datos, "id");
    if (!id) return { ok: false, error: "Falta el identificador." };

    await db.delete(campaigns).where(eq(campaigns.id, id));
    borrada = true;
    return { ok: true };
  });

  if (resultado.ok && borrada) {
    revalidar();
    redirect("/admin/campanas/");
  }

  return resultado;
}
