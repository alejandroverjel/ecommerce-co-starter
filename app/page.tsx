import Link from "next/link";
import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import { DatosNegocio } from "@/components/seo/datos-estructurados";
import { FranjaCampana } from "@/components/campana/franja-campana";
import { RejillaProductos } from "@/components/producto/tarjeta-producto";
import { buttonVariants } from "@/components/ui/button";
import { campanaVigente } from "@/lib/data/campanas";
import type { Categoria, ProductoLista } from "@/lib/data/catalogo";
import { SITIO } from "@/lib/sitio";
import { cn } from "@/lib/utils";
import { TIENDA } from "@/tienda.config";

export const metadata: Metadata = metadatosDePagina({
  titulo: TIENDA.seo.tituloPorDefecto,
  descripcion: SITIO.descripcion,
  ruta: "/",
});

// Se renderiza en cada petición: el build corre en CI sin acceso a la base
// de datos, que vive en la red privada del VPS.
export const dynamic = "force-dynamic";

/**
 * Destacados y categorías de la portada.
 *
 * La base se importa DENTRO de la función (import dinámico), no arriba: este
 * componente también se recolecta al construir /_not-found durante el build
 * de la imagen, donde no hay DATABASE_URL. Mismo patrón que
 * panel-carrito-servidor.tsx.
 */
async function catalogoPortada(): Promise<{
  destacados: ProductoLista[];
  categorias: Categoria[];
}> {
  try {
    const { listarDestacados, listarProductos, listarCategorias } = await import(
      "@/lib/data/catalogo"
    );
    const [destacados, todasCategorias] = await Promise.all([
      listarDestacados(8),
      listarCategorias(),
    ]);
    return {
      // Sin destacados marcados a mano, se muestran los primeros 8 del
      // catálogo: la portada nunca se ve vacía.
      destacados: destacados.length > 0 ? destacados : await listarProductos({ limite: 8 }),
      categorias: todasCategorias.filter((c) => c.cuantosProductos > 0),
    };
  } catch {
    return { destacados: [], categorias: [] };
  }
}

export default async function Portada() {
  const [{ destacados, categorias }, campana] = await Promise.all([
    catalogoPortada(),
    campanaVigente().catch(() => null),
  ]);

  return (
    <>
      <DatosNegocio />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="display text-3xl md:text-4xl">{TIENDA.nombre}</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {TIENDA.descripcion}
        </p>
      </section>

      {campana && <FranjaCampana campana={campana} />}

      {destacados.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="display text-2xl">Destacados</h2>
          <div className="mt-6">
            <RejillaProductos productos={destacados} />
          </div>
        </section>
      )}

      {categorias.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="display text-2xl">Categorías</h2>
          <ul className="mt-6 flex flex-wrap gap-3">
            {categorias.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/${c.slug}/`}
                  className="tarjeta inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium"
                >
                  {c.nombre}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/tienda/" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
            Ver todo el catálogo
          </Link>
        </section>
      )}
    </>
  );
}
