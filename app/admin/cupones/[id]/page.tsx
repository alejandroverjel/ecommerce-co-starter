import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { FormularioCupon } from "@/components/admin/formulario-cupon";
import { leerCuponAdmin } from "@/lib/data/cupones-admin";
import { exigirAdminPagina } from "@/lib/admin/pagina";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (id === "nuevo") return { title: "Nuevo cupón" };
  const cupon = await leerCuponAdmin(id);
  return { title: cupon ? cupon.code : "Cupón" };
}

export default async function EditarCupon({ params }: Props) {
  await exigirAdminPagina();
  const { id } = await params;

  // "/admin/cupones/nuevo/" es el formulario en blanco. Cualquier otro id debe
  // ser un uuid real; si no, 404 (Postgres respondería con error de sintaxis).
  const esNuevo = id === "nuevo";
  if (!esNuevo && !UUID.test(id)) notFound();

  const cupon = esNuevo ? null : await leerCuponAdmin(id);
  if (!esNuevo && !cupon) notFound();

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <Link
        href="/admin/cupones/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--texto-suave)] transition-colors hover:text-[var(--acento)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Cupones
      </Link>

      <h1 className="display mt-3 text-3xl">
        {esNuevo ? "Nuevo cupón" : cupon!.code}
      </h1>
      {!esNuevo && cupon!.usos > 0 && (
        <p className="mt-1 text-sm text-[var(--texto-suave)]">
          Usado en {cupon!.usos} {cupon!.usos === 1 ? "pedido" : "pedidos"}.
        </p>
      )}

      <div className="mt-6">
        <FormularioCupon cupon={cupon} />
      </div>
    </div>
  );
}
