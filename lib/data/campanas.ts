import "server-only";

import { and, desc, eq, lte, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { hoyEnBogota } from "@/lib/validaciones/pedido";

export type CampanaVigente = {
  titulo: string;
  cuerpo: string;
  imagenUrl: string | null;
  imagenMovilUrl: string | null;
  imagenAlt: string;
  colorFondo: string | null;
  ctaTexto: string | null;
  ctaRuta: string | null;
  /** Días entre hoy y el último día, ambos en Bogotá. 0 = termina hoy. */
  diasRestantes: number;
};

/**
 * La campana que toca mostrar hoy, o null si no hay ninguna.
 *
 * La fecha se calcula en la ZONA DEL NEGOCIO, no en la del servidor. Atarse a
 * la hora de la maquina significa que una campana podria encenderse antes o
 * despues de lo previsto segun donde corra el contenedor. `hoyEnBogota()`
 * devuelve la fecha en la zona de la tienda y se compara contra columnas
 * `date`, sin horas de por medio.
 *
 * Si dos campanas se solapan gana la que empezo mas tarde: al programar
 * Navidad encima de una promocion de diciembre, lo natural es que la mas
 * reciente sea la que manda.
 */
export async function campanaVigente(): Promise<CampanaVigente | null> {
  const hoy = hoyEnBogota();

  const [fila] = await db
    .select({
      titulo: campaigns.title,
      cuerpo: campaigns.body,
      imagenUrl: campaigns.imageUrl,
      imagenMovilUrl: campaigns.imageMobileUrl,
      imagenAlt: campaigns.imageAlt,
      colorFondo: campaigns.backgroundColor,
      ctaTexto: campaigns.ctaLabel,
      ctaRuta: campaigns.ctaHref,
      fin: campaigns.endsOn,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.enabled, true),
        lte(campaigns.startsOn, hoy),
        gte(campaigns.endsOn, hoy),
      ),
    )
    // DESC: la que empezó más tarde, como promete el comentario de arriba.
    // Con asc ganaba la MÁS VIEJA y programar Navidad encima de una promo
    // de diciembre dejaba la promo vieja en pantalla.
    .orderBy(desc(campaigns.startsOn))
    .limit(1);

  if (!fila) return null;

  const { fin, ...resto } = fila;

  /**
   * Diferencia en dias entre dos fechas `YYYY-MM-DD`.
   *
   * Se construyen ambas a mediodia UTC para restarlas. Con medianoche, un
   * desfase de horas —el que introduce cualquier cambio de horario -- puede
   * mover el resultado un dia entero; a mediodia sobran doce horas de margen
   * por cada lado y la resta siempre cae en el dia correcto.
   */
  const aMedioDia = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
  const diasRestantes = Math.max(
    0,
    Math.round((aMedioDia(fin) - aMedioDia(hoy)) / 86_400_000),
  );

  return {
    ...resto,
    /** Decorativa por defecto: un alt inventado es peor que uno vacio. */
    imagenAlt: fila.imagenAlt ?? "",
    diasRestantes,
  };
}
