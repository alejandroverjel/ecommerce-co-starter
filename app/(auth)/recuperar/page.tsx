import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { FormularioPedirEnlace } from "@/components/auth/formulario-recuperar";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false, follow: false },
};

export default async function Recuperar() {
  // Quien ya entró no necesita recuperar nada.
  const sesion = await auth();
  if (sesion?.user) redirect("/mi-cuenta/");

  return <FormularioPedirEnlace />;
}
