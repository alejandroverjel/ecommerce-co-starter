import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { hoyEnBogota } from "@/lib/validaciones/pedido";

/**
 * Consultas de campañas para el panel.
 *
 * Aparte de `lib/data/campanas.ts` —que solo lee la campaña VIGENTE para la
 * portada— porque el admin ve todas: las pasadas, las futuras y las apagadas.
 *
 * SIN RLS: la autorización es de quien llama. Las páginas pasan por
 * `exigirAdminPagina` y las escrituras por `exigirAdmin`.
 */

export type CampanaAdmin = {
  id: string;
  nombre: string;
  titulo: string;
  inicio: string;
  fin: string;
  activa: boolean;
  /** Calculado contra la fecha de Bogotá: vigente / próxima / terminada. */
  estado: "vigente" | "proxima" | "terminada" | "apagada";
  imagenUrl: string | null;
};

/** El estado que se le muestra a quien administra, ya resuelto contra hoy. */
function estadoCampana(
  activa: boolean,
  inicio: string,
  fin: string,
  hoy: string,
): CampanaAdmin["estado"] {
  if (!activa) return "apagada";
  if (fin < hoy) return "terminada";
  if (inicio > hoy) return "proxima";
  return "vigente";
}

export async function listarCampanas(): Promise<CampanaAdmin[]> {
  const hoy = hoyEnBogota();

  const filas = await db
    .select({
      id: campaigns.id,
      nombre: campaigns.name,
      titulo: campaigns.title,
      inicio: campaigns.startsOn,
      fin: campaigns.endsOn,
      activa: campaigns.enabled,
      imagenUrl: campaigns.imageUrl,
    })
    .from(campaigns)
    .orderBy(desc(campaigns.startsOn));

  return filas.map((f) => ({
    ...f,
    estado: estadoCampana(f.activa, f.inicio, f.fin, hoy),
  }));
}

export type FichaCampanaAdmin = {
  id: string;
  nombre: string;
  titulo: string;
  cuerpo: string;
  imagenUrl: string | null;
  imagenMovilUrl: string | null;
  imagenAlt: string | null;
  colorFondo: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  inicio: string;
  fin: string;
  activa: boolean;
};

export async function leerCampanaAdmin(
  id: string,
): Promise<FichaCampanaAdmin | null> {
  const [fila] = await db
    .select({
      id: campaigns.id,
      nombre: campaigns.name,
      titulo: campaigns.title,
      cuerpo: campaigns.body,
      imagenUrl: campaigns.imageUrl,
      imagenMovilUrl: campaigns.imageMobileUrl,
      imagenAlt: campaigns.imageAlt,
      colorFondo: campaigns.backgroundColor,
      ctaLabel: campaigns.ctaLabel,
      ctaHref: campaigns.ctaHref,
      inicio: campaigns.startsOn,
      fin: campaigns.endsOn,
      activa: campaigns.enabled,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  return fila ?? null;
}
