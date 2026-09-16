import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import Link from "next/link";

import { RejillaProductos } from "@/components/producto/tarjeta-producto";
import { BuscadorTienda } from "@/components/tienda/buscador";
import { FiltrosTienda } from "@/components/tienda/filtros-tienda";
import { DatosColeccion, DatosMigas } from "@/components/seo/datos-estructurados";
import {
  buscarProductos,
  listarCategorias,
  listarProductos,
  type OrdenTienda,
} from "@/lib/data/catalogo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TIENDA } from "@/tienda.config";

// Se renderiza en cada petición: el build no tiene acceso a la base, y la
// búsqueda depende de searchParams de todos modos.
export const dynamic = "force-dynamic";

export const metadata: Metadata = metadatosDePagina({
  titulo: "Catálogo",
  descripcion: `Todo el catálogo de ${TIENDA.nombre}.`,
  ruta: "/tienda/",
});

export default async function Tienda({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoria?: string; orden?: string }>;
}) {
  const { q, categoria: catParam, orden: ordenParam } = await searchParams;
  const termino = q?.trim() ?? "";

  const categorias = (await listarCategorias()).filter((c) => c.cuantosProductos > 0);

  // Solo categorías reales; cualquier otra se ignora (no filtra).
  const categoria = categorias.some((c) => c.slug === catParam) ? (catParam as string) : "";
  // Por defecto, el orden que declara la tienda; el enlace de un filtro puede
  // pedir el contrario explícitamente.
  const orden: OrdenTienda =
    ordenParam === "precio-asc" || ordenParam === "precio-desc"
      ? ordenParam
      : TIENDA.catalogo.ordenPorDefecto;

  // El buscador y los filtros son excluyentes: buscar manda sobre filtrar.
  const productos = termino
    ? await buscarProductos(termino)
    : await listarProductos({ categoria: categoria || undefined, orden });

  return (
    <>
      {!termino && (
        <>
          <DatosMigas
            migas={[
              { nombre: "Inicio", ruta: "/" },
              { nombre: "Tienda", ruta: "/tienda/" },
            ]}
          />
          <DatosColeccion
            nombre="Catálogo"
            descripcion={`Catálogo completo de ${TIENDA.nombre}.`}
            ruta="/tienda/"
            productos={productos.map((p) => ({
              nombre: p.nombre,
              ruta: p.ruta,
              precioCop: p.precioCop,
              imagen: p.imagen,
              disponible: p.disponible,
            }))}
          />
        </>
      )}

      <div className="mx-auto max-w-6xl px-4 py-10">
        <header>
          <h1 className="display text-3xl md:text-4xl">
            {termino ? "Resultados" : "Catálogo"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {termino ? (
              <>
                {productos.length}{" "}
                {productos.length === 1 ? "producto" : "productos"} para{" "}
                <span className="font-medium text-foreground">&ldquo;{termino}&rdquo;</span>
              </>
            ) : (
              <>
                {productos.length} {productos.length === 1 ? "producto" : "productos"}.
              </>
            )}
          </p>
        </header>

        {/* Búsqueda por GET: funciona sin JavaScript y deja la consulta en la
            URL, así se puede compartir y volver atrás. */}
        <BuscadorTienda inicial={termino} />

        {/* Filtros de categoría y precio. No se muestran durante una búsqueda:
            ahí manda el término. */}
        {!termino && <FiltrosTienda categoria={categoria} orden={orden} categorias={categorias} />}

        <div className="mt-10">
          {productos.length > 0 ? (
            <RejillaProductos productos={productos} />
          ) : (
            <div className="tarjeta mx-auto max-w-md p-10 text-center">
              <p className="display text-2xl">No encontramos nada</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Prueba con otra palabra o mira el catálogo completo.
              </p>
              <Link href="/tienda/" className={cn(buttonVariants(), "mt-6")}>
                Ver todo el catálogo
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
