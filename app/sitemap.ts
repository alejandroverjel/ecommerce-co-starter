import type { MetadataRoute } from "next";

import { listarCategorias, listarRutasProducto } from "@/lib/data/catalogo";
import { SITIO } from "@/lib/sitio";

/**
 * Sitemap XML.
 *
 * Las URLs llevan barra final para coincidir exactamente con lo que Google
 * tiene indexado de la plataforma anterior (`trailingSlash: true`). Una barra de diferencia
 * es una redirección extra en cada rastreo.
 *
 * Quedan fuera: carrito, pago y cuenta. No son contenido y el robots.txt
 * también los bloquea.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITIO.dominio;

  /**
   * SIN lastModified en las páginas que no sabemos cuándo cambiaron.
   *
   * Antes llevaban `new Date()`: como la ruta es force-dynamic, cada descarga
   * del sitemap declaraba "esta página cambió AHORA MISMO" para once URLs.
   * Un lastmod que siempre es ahora es un lastmod que siempre miente, y
   * Google lo documenta explícitamente: si detecta que no es fiable, deja de
   * usarlo PARA TODO el sitio — incluidas las fichas, cuyas fechas sí son
   * reales. Mejor callar que mentir.
   */
  const estaticas: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/tienda/`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/contactenos/`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/politica-de-entrega/`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/politica-de-devoluciones/`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terminos-y-condiciones/`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/politica-de-privacidad/`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Si la base no responde, se sirve el sitemap con las páginas fijas en vez
  // de devolver un 500: un sitemap incompleto es mejor que ninguno.
  let categoriasDb: Awaited<ReturnType<typeof listarCategorias>> = [];
  let rutas: Awaited<ReturnType<typeof listarRutasProducto>> = [];
  try {
    [categoriasDb, rutas] = await Promise.all([listarCategorias(), listarRutasProducto()]);
  } catch {
    console.warn("[sitemap] Sin acceso a la base de datos: se omiten categorías y fichas.");
  }

  // Categorías vacías fuera: anunciar a Google una vitrina sin productos es
  // una visita de rastreo desperdiciada.
  const categorias: MetadataRoute.Sitemap = categoriasDb
    .filter((c) => c.cuantosProductos > 0)
    .map((c) => ({
      url: `${base}/${c.slug}/`,
      changeFrequency: "weekly",
      priority: 0.8,
    }));

  const fichas: MetadataRoute.Sitemap = rutas.map((r) => ({
    url: `${base}/tienda/${r.slugCategoria}/${r.slugProducto}/`,
    // Fecha real de la base: Google detecta qué cambió sin volver a leer todo.
    lastModified: r.actualizado,
    changeFrequency: "weekly",
    priority: 0.7,
    // Una image:loc por producto: Google Imágenes es un canal de descubrimiento
    // directo en un catálogo visual, donde la gente busca la foto del
    // producto antes que su nombre.
    ...(r.imagen ? { images: [`${base}${r.imagen}`] } : {}),
  }));

  return [...estaticas, ...categorias, ...fichas];
}
