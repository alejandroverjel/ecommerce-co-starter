import Link from "next/link";

import { SITIO } from "@/lib/sitio";

// El menú del layout raíz depende de la base (ver categoriasMenu en
// app/layout.tsx): sin esto, el build sin DATABASE_URL congelaría el menú
// vacío en el HTML de estas páginas.
export const dynamic = "force-dynamic";

export default function LayoutAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <Link href="/" className="display text-center text-2xl leading-none text-foreground">
        {SITIO.nombre}
      </Link>

      <div className="mt-8">{children}</div>
    </div>
  );
}
