import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ExternalLink, Plus, Star } from "lucide-react";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { listarProductosAdmin } from "@/lib/data/admin";
import { exigirPersonalPagina } from "@/lib/admin/pagina";
import { rutaProducto } from "@/lib/data/catalogo";
import { formatearCOP } from "@/lib/formato";

export const metadata: Metadata = { title: "Productos" };
export const dynamic = "force-dynamic";

export default async function ProductosAdmin() {
  await exigirPersonalPagina();
  const productos = await listarProductosAdmin();
  const agotados = productos.filter((p) => p.estado === "activo" && p.stock <= 0).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Productos</h1>
          <p className="mt-1 text-[var(--texto-suave)]">
            {productos.length} en el catálogo
            {agotados > 0 && ` · ${agotados} agotados`}
          </p>
        </div>
        <Link
          href="/admin/productos/nuevo/"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-5 py-2.5 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo producto
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-widest text-[var(--texto-tenue)]">
              <th className="px-5 py-3 font-semibold">Producto</th>
              <th className="px-5 py-3 font-semibold">Categoría</th>
              <th className="px-5 py-3 font-semibold">Estado</th>
              <th className="px-5 py-3 text-right font-semibold">Stock</th>
              <th className="px-5 py-3 text-right font-semibold">Precio</th>
              <th className="px-5 py-3">
                <span className="solo-lectores">Editar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr
                key={p.id}
                className="border-b transition-colors last:border-0 hover:bg-[var(--fondo-hondo)]"
              >
                <td className="px-5 py-3">
                  {/* El nombre lleva a la edición, no a la ficha pública: desde
                      aquí lo que se viene a hacer es cambiar un precio o
                      reponer stock. Ver la tienda es el enlace de al lado. */}
                  <Link
                    href={`/admin/productos/${p.id}/`}
                    className="font-medium hover:text-[var(--acento)] hover:underline"
                  >
                    {p.nombre}
                  </Link>
                  {p.destacado && (
                    <Star
                      className="ml-1.5 inline size-3.5 text-[var(--acento)]"
                      aria-label="En portada"
                    />
                  )}
                  <span className="flex items-center gap-1.5 text-xs text-[var(--texto-tenue)]">
                    {p.slug}
                    {p.estado === "activo" && (
                      <Link
                        href={rutaProducto(p.categoriaSlug, p.slug)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Ver ${p.nombre} en la tienda`}
                        className="hover:text-[var(--acento)]"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                  </span>
                </td>
                <td className="px-5 py-3 text-[var(--texto-suave)]">
                  {p.categoria ?? "—"}
                </td>
                <td className="px-5 py-3">
                  <EtiquetaEstado
                    estado={p.estado === "activo" && p.stock <= 0 ? "agotado" : p.estado}
                  />
                </td>
                <td
                  className={`precio whitespace-nowrap px-5 py-3 text-right ${
                    p.stock <= 0 ? "text-[var(--peligro)]" : ""
                  }`}
                >
                  {p.stock}
                </td>
                <td className="cifra whitespace-nowrap px-5 py-3 text-right">
                  {p.precioCop === null ? "—" : formatearCOP(p.precioCop)}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/admin/productos/${p.id}/`}
                    aria-label={`Editar ${p.nombre}`}
                    className="inline-flex text-[var(--texto-tenue)] hover:text-[var(--acento)]"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
