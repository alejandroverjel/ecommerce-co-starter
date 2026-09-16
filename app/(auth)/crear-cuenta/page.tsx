import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { FormularioRegistro } from "@/components/auth/formulario-registro";

export const metadata: Metadata = {
  title: "Crear cuenta",
  robots: { index: false, follow: false },
};

export default async function CrearCuenta() {
  const sesion = await auth();
  if (sesion?.user) redirect("/mi-cuenta/");

  return <FormularioRegistro />;
}
