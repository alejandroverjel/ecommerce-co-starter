import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FormularioNuevoProducto } from "@/components/admin/formulario-nuevo-producto";
import { listarCategoriasAdmin } from "@/lib/data/admin";
import { exigirPersonalPagina } from "@/lib/admin/pagina";

export const metadata: Metadata = { title: "Nuevo producto" };
export const dynamic = "force-dynamic";

export default async function NuevoProducto() {
  await exigirPersonalPagina();
  const categorias = await listarCategoriasAdmin();

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <Link
        href="/admin/productos/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--texto-suave)] transition-colors hover:text-[var(--acento)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Productos
      </Link>

      <h1 className="display mt-3 text-3xl">Nuevo producto</h1>

      <div className="mt-6">
        <FormularioNuevoProducto categorias={categorias} />
      </div>
    </div>
  );
}
