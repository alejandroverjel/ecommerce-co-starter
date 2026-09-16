import type { Metadata } from "next";

import { MARCA, SITIO } from "@/lib/sitio";

/**
 * Constructor de metadatos por página.
 *
 * POR QUÉ EXISTE: los objetos `openGraph` de Next NO se fusionan con el del
 * layout — lo reemplazan entero. Cada página que declaraba su `openGraph`
 * parcial perdía la imagen de compartir, el `siteName` y el `locale`; y las
 * que no declaraban nada heredaban el `og:url` de la portada, así que
 * compartir /contactenos/ en redes atribuía la visita a la home.
 *
 * Una sola función arma el juego completo y coherente: canónico, Open Graph y
 * Twitter siempre apuntando a la MISMA ruta, con la imagen de marca como
 * respaldo cuando la página no tiene una propia.
 */
export function metadatosDePagina(opciones: {
  titulo: string;
  descripcion: string;
  /** Ruta con barra final: "/contactenos/". */
  ruta: string;
  /** Imagen propia (absoluta o relativa); si falta, va la tarjeta de marca. */
  imagen?: { url: string; alt: string; ancho?: number; alto?: number };
  noIndex?: boolean;
}): Metadata {
  const { titulo, descripcion, ruta, imagen, noIndex = false } = opciones;

  const url = `${SITIO.dominio}${ruta}`;
  // Sin imagen propia ni MARCA.imagenCompartir configurada, no se emite
  // ninguna: un og:image roto es peor que no tener ninguno.
  const imagenFinal =
    imagen ?? (MARCA.compartir ? { url: MARCA.compartir, alt: SITIO.nombre, ancho: 1200, alto: 630 } : null);
  const locale = SITIO.idioma.replace("-", "_");

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: ruta },
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      /**
       * "website" también en las fichas, a propósito.
       *
       * Un "product" describiría mejor una ficha, pero Next 16 no solo lo
       * excluye de los tipos: lo RECHAZA en ejecución —"Invalid OpenGraph
       * type: product"— y descarta el bloque openGraph entero, dejando la
       * ficha sin og:title, og:image ni og:url. Y por `other` saldría como
       * `name=`, no `property=`, que los rastreadores de Open Graph no leen.
       *
       * Perder todas las etiquetas Open Graph para ganar uno cosmético es mal
       * negocio: quien de verdad clasifica la página como producto es el
       * JSON-LD `Product` de components/seo/datos-estructurados.tsx, que sí
       * es lo que Google usa para los resultados enriquecidos.
       */
      type: "website",
      url,
      siteName: SITIO.nombre,
      locale,
      title: titulo,
      description: descripcion,
      ...(imagenFinal
        ? {
            images: [
              {
                url: imagenFinal.url,
                alt: imagenFinal.alt,
                ...(imagenFinal.ancho ? { width: imagenFinal.ancho } : {}),
                ...(imagenFinal.alto ? { height: imagenFinal.alto } : {}),
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: titulo,
      description: descripcion,
      ...(imagenFinal ? { images: [imagenFinal.url] } : {}),
    },
  };
}
