import type { MetadataRoute } from "next";

import { SITIO } from "@/lib/sitio";

/**
 * robots.txt
 *
 * Declara el sitemap: es la forma más directa de que Google encuentre todas
 * las fichas de producto, sobre todo tras una migración.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/carrito/",
          "/finalizar-compra/",
          "/mi-cuenta/",
          "/api/",
          "/admin/",
          // Bloquea la búsqueda con parámetros: son infinitas combinaciones de
          // contenido duplicado que consumen presupuesto de rastreo.
          "/tienda/?q=",
        ],
      },
    ],
    sitemap: `${SITIO.dominio}/sitemap.xml`,
    // Sin `host`: es una directiva exclusiva de Yandex que además exige el
    // dominio pelado, no una URL. Con "https://..." el robots.txt entero se
    // marca como inválido (Lighthouse SEO 92 en vez de 100) y ningún buscador
    // que nos importe la lee.
  };
}
