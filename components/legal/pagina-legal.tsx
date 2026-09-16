import Link from "next/link";

import { formatearFechaSola } from "@/lib/formato";

/**
 * Envoltorio de las páginas legales.
 *
 * Tipografía más ancha y con más interlineado que el resto del sitio: son
 * textos largos que la gente lee de verdad cuando hay un problema, no
 * decoración de pie de página.
 */
export function PaginaLegal({
  titulo,
  actualizado,
  children,
}: {
  titulo: string;
  /** Fecha ISO. Se muestra porque un texto legal sin fecha no sirve de nada. */
  actualizado: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 md:py-16">
      <nav aria-label="Ruta de navegación">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="transition-colors hover:text-foreground hover:underline">
              Inicio
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page">{titulo}</li>
        </ol>
      </nav>

      <h1 className="display mt-6 text-3xl md:text-4xl">{titulo}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: {formatearFechaSola(actualizado)}
      </p>

      {/* Textos largos que la gente lee de verdad cuando tiene un problema:
          más espacio e interlineado que el resto del sitio, no decoración. */}
      <div
        className="
          bloque mt-8 space-y-6 p-7 leading-relaxed text-muted-foreground sm:p-10
          [&_a]:text-primary [&_a]:underline
          [&_h2]:display [&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:text-foreground
          [&_h2:first-child]:mt-0
          [&_h3]:mt-8 [&_h3]:font-medium [&_h3]:text-foreground
          [&_li]:ml-5 [&_li]:list-disc
          [&_ol]:space-y-2
          [&_strong]:font-medium [&_strong]:text-foreground
          [&_ul]:space-y-2
        "
      >
        {children}
      </div>
    </div>
  );
}
