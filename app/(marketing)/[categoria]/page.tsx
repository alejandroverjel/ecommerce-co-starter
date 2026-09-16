import Link from "next/link";
import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import { notFound } from "next/navigation";

import { RejillaProductos } from "@/components/producto/tarjeta-producto";
import { DatosColeccion, DatosMigas } from "@/components/seo/datos-estructurados";
import { buttonVariants } from "@/components/ui/button";
import { buscarCategoriaEnDb, listarProductosDeCategoria } from "@/lib/data/catalogo";
import { cn } from "@/lib/utils";

/**
 * ISR: se genera en la primera visita y se sirve cacheada una hora.
 *
 * Antes era `force-dynamic`, lo que costaba una consulta a Postgres y un
 * render completo en CADA visita a las páginas de categoría —las de mayor
 * tráfico después de la portada—. Medido con 10 peticiones a la vez, el TTFB
 * pasaba de ~0,33 s a ~0,82 s, y la respuesta salía con `no-store`, así que ni
 * el navegador ni Cloudflare podían guardarla.
 *
 * No se prerenderiza en el build (allí no hay base: `generateStaticParams`
 * devuelve [] si no puede leerla), así que sigue sin exponerse Postgres a
 * internet. Y la caché no se queda vieja: al guardar un producto
 * acciones-producto ya llama `revalidatePath("/{categoria}/")` para cada
 * categoría afectada — estaba escrito para este momento.
 */
export const revalidate = 3600;

/**
 * Los slugs válidos son los que existen en la tabla `categories`; cualquier
 * otro devuelve 404 más abajo. Las rutas estáticas (`/tienda/`, `/carrito/`,
 * `/contactenos/`) ganan sobre esta dinámica, así que no hay conflicto.
 */
export async function generateStaticParams() {
  /**
   * Lista vacía A PROPÓSITO, igual que en la ficha de producto.
   *
   * Devolver aquí los slugs haría que el build prerenderizara las categorías,
   * y el build corre en GitHub Actions, donde la base NO es alcanzable: la
   * página saldría vacía o el build fallaría. Con [] no se prerenderiza nada;
   * cada categoría se genera en su primera visita y queda cacheada (ISR).
   *
   * `dynamicParams` sigue en true (por defecto), así que los slugs válidos
   * responden igual; los inválidos caen en el notFound() de más abajo.
   */
  return [];
}

type Props = { params: Promise<{ categoria: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categoria: slug } = await params;
  const categoria = await buscarCategoriaEnDb(slug);

  if (!categoria || categoria.cuantosProductos === 0) {
    return { title: "Categoría no encontrada" };
  }

  return metadatosDePagina({
    titulo: categoria.nombre,
    descripcion: categoria.descripcion ?? categoria.nombre,
    ruta: `/${slug}/`,
  });
}

export default async function PaginaCategoria({ params }: Props) {
  const { categoria: slug } = await params;
  const categoria = await buscarCategoriaEnDb(slug);

  // Sin categoría, o sin ningún producto publicado: ambos casos son 404. Una
  // categoría vacía indexada no aporta nada y compite mal en resultados.
  if (!categoria || categoria.cuantosProductos === 0) notFound();

  const productos = await listarProductosDeCategoria(slug);

  const migas = [
    { nombre: "Inicio", ruta: "/" },
    { nombre: categoria.nombre, ruta: `/${slug}/` },
  ];

  return (
    <>
      <DatosMigas migas={migas} />
      <DatosColeccion
        nombre={categoria.nombre}
        descripcion={categoria.descripcion ?? categoria.nombre}
        ruta={`/${slug}/`}
        productos={productos.map((p) => ({
          nombre: p.nombre,
          ruta: p.ruta,
          precioCop: p.precioCop,
          imagen: p.imagen,
          disponible: p.disponible,
        }))}
      />

      <div className="mx-auto max-w-6xl px-4 py-10">
        <nav aria-label="Ruta de navegación">
          <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <li>
              <Link href="/" className="transition-colors hover:text-foreground">
                Inicio
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-foreground">
              {categoria.nombre}
            </li>
          </ol>
        </nav>

        <header className="mt-6 max-w-2xl">
          <h1 className="display text-3xl md:text-4xl">{categoria.nombre}</h1>
          {categoria.descripcion && (
            <p className="mt-4 leading-relaxed text-muted-foreground">{categoria.descripcion}</p>
          )}
        </header>

        <div className="mt-10">
          {productos.length > 0 ? (
            <>
              {/* Los títulos de las tarjetas son h3; sin este h2 el orden de
                  encabezados salta de h1 a h3 y los lectores de pantalla
                  pierden la jerarquía de la página. */}
              <h2 className="solo-lectores">Productos de la categoría</h2>
              <RejillaProductos productos={productos} />
            </>
          ) : (
            <div className="tarjeta mx-auto max-w-md p-10 text-center">
              <p className="display text-2xl">Estamos surtiendo</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Todavía no hay productos publicados en {categoria.nombre.toLowerCase()}.
                Mientras tanto puedes ver el resto del catálogo.
              </p>
              <Link href="/tienda/" className={cn(buttonVariants(), "mt-6")}>
                Ver toda la tienda
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
