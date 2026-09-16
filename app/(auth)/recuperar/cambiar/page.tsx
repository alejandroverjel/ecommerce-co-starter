import type { Metadata } from "next";
import Link from "next/link";

import { FormularioCambiar } from "@/components/auth/formulario-recuperar";

export const metadata: Metadata = {
  title: "Cambiar contraseña",
  robots: { index: false, follow: false },
};

/**
 * Segundo paso del enlace del correo.
 *
 * NO se comprueba el token aquí. Podría hacerse para enseñar antes "este
 * enlace venció", pero eso convertiría la página en un oráculo: quien fuera
 * probando tokens sabría cuáles existen sin llegar a usarlos. Se valida al
 * enviar el formulario, en la misma transacción que cambia la contraseña.
 */
export default async function Cambiar({
  searchParams,
}: {
  searchParams: Promise<{ correo?: string; token?: string }>;
}) {
  const { correo, token } = await searchParams;

  if (!correo || !token) {
    return (
      <div className="tarjeta p-7 text-center">
        <h1 className="display text-2xl">Enlace incompleto</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--texto-suave)]">
          Ábrelo tal cual llegó al correo, sin recortarlo. Si no funciona, pide uno nuevo.
        </p>
        <Link
          href="/recuperar/"
          className="mt-6 inline-block text-sm font-medium text-[var(--acento)] hover:underline"
        >
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  }

  return <FormularioCambiar correo={correo} token={token} />;
}
