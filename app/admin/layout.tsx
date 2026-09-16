import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, rolReal } from "@/auth";
import { salir } from "@/lib/auth/acciones";
import { NavAdmin } from "@/components/admin/nav-admin";

export const metadata: Metadata = {
  title: { default: "Panel", template: "%s · Panel" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LayoutAdmin({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await auth();
  if (!sesion?.user?.id) redirect("/entrar/");

  /**
   * El rol se relee de la BASE, no del token.
   *
   * El rol viaja dentro del JWT: si a alguien se le quita el permiso de
   * administrador, su token sigue diciendo "admin" hasta que expire, siete
   * días después. Preguntándole a la base, pierde el acceso al instante.
   *
   * Cuesta una consulta por carga de página del panel. Es barato comparado con
   * dejar entrar a quien ya no debe.
   */
  const rol = await rolReal(sesion.user.id);
  if (rol !== "admin" && rol !== "staff") {
    // 404 y no "no tienes permiso": confirmar que el panel existe en esta ruta
    // es información que no hace falta dar.
    redirect("/");
  }

  return (
    <div className="min-h-dvh bg-[var(--fondo-hondo)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/admin/" className="display text-2xl leading-none">
              Panel
            </Link>
            <p className="mt-1 text-sm text-[var(--texto-tenue)]">
              {sesion.user.name ?? sesion.user.email} ·{" "}
              {rol === "admin" ? "Administrador" : "Equipo"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-full border px-4 py-2 text-sm transition-colors hover:bg-[var(--fondo-elevado)]"
            >
              Ver la tienda
            </Link>
            <form action={salir}>
              <button
                type="submit"
                className="rounded-full border px-4 py-2 text-sm transition-colors hover:bg-[var(--fondo-elevado)]"
              >
                Salir
              </button>
            </form>
          </div>
        </header>

        <NavAdmin esAdmin={rol === "admin"} />

        {/* El pie es el global de la tienda y se pinta justo después de este
            contenedor: sin margen inferior el panel queda pegado a él. */}
        <main className="mt-6 pb-20">{children}</main>
      </div>
    </div>
  );
}
