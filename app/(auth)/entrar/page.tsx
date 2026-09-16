import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { FormularioEntrar } from "@/components/auth/formulario-entrar";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

export default async function Entrar() {
  // Quien ya entró no tiene nada que hacer aquí.
  const sesion = await auth();
  if (sesion?.user) redirect("/mi-cuenta/");

  return <FormularioEntrar />;
}
