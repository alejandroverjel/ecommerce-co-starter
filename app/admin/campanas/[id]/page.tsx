import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { FormularioCampana } from "@/components/admin/formulario-campana";
import { leerCampanaAdmin } from "@/lib/data/campanas-admin";
import { exigirAdminPagina } from "@/lib/admin/pagina";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (id === "nueva") return { title: "Nueva campaña" };
  const campana = await leerCampanaAdmin(id);
  return { title: campana ? campana.nombre : "Campaña" };
}

export default async function EditarCampana({ params }: Props) {
  await exigirAdminPagina();
  const { id } = await params;

  const esNueva = id === "nueva";
  if (!esNueva && !UUID.test(id)) notFound();

  const campana = esNueva ? null : await leerCampanaAdmin(id);
  if (!esNueva && !campana) notFound();

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <Link
        href="/admin/campanas/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--texto-suave)] transition-colors hover:text-[var(--acento)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Campañas
      </Link>

      <h1 className="display mt-3 text-3xl">
        {esNueva ? "Nueva campaña" : campana!.nombre}
      </h1>

      <div className="mt-6">
        <FormularioCampana campana={campana} />
      </div>
    </div>
  );
}
