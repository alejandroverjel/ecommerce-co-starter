import { permanentRedirect } from "next/navigation";

/**
 * `/tienda/{categoria}/` no es una página propia: el sitemap solo tiene
 * `/tienda/` y `/tienda/{categoria}/{producto}/`.
 *
 * La ruta existe aquí solo porque es el tramo padre de la ficha de producto.
 * Servir un listado aquí crearía contenido duplicado con `/{categoria}/`, que
 * sí es la página canónica, así que se redirige. En producción responde el
 * 301 de next.config.ts antes de llegar aquí; esto queda como red (308).
 */
export default async function CategoriaBajoTienda({
  params,
}: {
  params: Promise<{ categoria: string }>;
}) {
  const { categoria } = await params;
  permanentRedirect(`/${categoria}/`);
}
