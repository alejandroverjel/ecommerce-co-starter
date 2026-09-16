import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageIcon, Layers, Star } from "lucide-react";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { FormularioProducto } from "@/components/admin/formulario-producto";
import { leerProductoAdmin, listarCategoriasAdmin } from "@/lib/data/admin";
import { exigirPersonalPagina } from "@/lib/admin/pagina";
import { formatearCOP } from "@/lib/formato";

/**
 * Ficha de edición de un producto.
 *
 * La autorización la resuelve app/admin/layout.tsx, que relee el rol de la
 * base antes de renderizar cualquier cosa bajo /admin. Aquí no se repite para
 * no gastar una segunda consulta por carga; lo que SÍ vuelve a comprobar el
 * rol es la server action, porque a ella se puede llegar sin pasar por esta
 * página.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Producto" };

  const producto = await leerProductoAdmin(id);
  return { title: producto ? producto.nombre : "Producto" };
}

function Dato({ icono: Icono, children }: { icono: typeof Layers; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-[var(--texto-suave)]">
      <Icono className="size-4 text-[var(--texto-tenue)]" aria-hidden />
      {children}
    </span>
  );
}

export default async function EditarProducto({ params }: Props) {
  const actor = await exigirPersonalPagina();
  const { id } = await params;

  // Un id que ni siquiera es un uuid ni llega a la base: Postgres respondería
  // con un error de sintaxis, no con "no encontrado".
  if (!UUID.test(id)) notFound();

  const [producto, categorias] = await Promise.all([
    leerProductoAdmin(id),
    listarCategoriasAdmin(),
  ]);

  if (!producto) notFound();

  const precios = producto.variantes.map((v) => v.precioCop);
  const stockTotal = producto.variantes
    .filter((v) => v.activa)
    .reduce((suma, v) => suma + v.stock, 0);

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <Link
        href="/admin/productos/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--texto-suave)] transition-colors hover:text-[var(--acento)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Productos
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display text-3xl">{producto.nombre}</h1>
          <EtiquetaEstado
            estado={
              producto.estado === "activo" && stockTotal <= 0 ? "agotado" : producto.estado
            }
          />
          {producto.destacado && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Star className="size-3" aria-hidden />
              En portada
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          <Dato icono={Layers}>
            {producto.variantes.length === 1
              ? "1 variante"
              : `${producto.variantes.length} variantes`}
            {precios.length > 0 && ` · desde ${formatearCOP(Math.min(...precios))}`}
          </Dato>
          <Dato icono={ImageIcon}>
            {producto.imagenes === 1 ? "1 foto" : `${producto.imagenes} fotos`}
          </Dato>
        </div>
      </header>

      <div className="mt-6">
        <FormularioProducto
          producto={producto}
          categorias={categorias}
          esAdmin={actor.rol === "admin"}
        />
      </div>
    </div>
  );
}
