import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 404.
 *
 * Puede recibir tráfico real de enlaces viejos que no se redirigieron, así
 * que no es un callejón sin salida: ofrece por dónde seguir.
 *
 * SOLO enlaces fijos (/ y /tienda/), sin categorías: esta página se genera de
 * forma ESTÁTICA en el build (/_not-found), donde no hay acceso a la base de
 * datos — listar categorías aquí las congelaría vacías hasta el próximo
 * despliegue. Ver la nota de deuda técnica.
 */
export default function NoEncontrado() {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-4 py-20 text-center sm:px-6">
      <div>
        <p className="cifra text-6xl text-primary">404</p>

        <h1 className="display mt-5 text-3xl md:text-4xl">Esta página ya no existe</h1>

        <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted-foreground">
          Puede que el producto haya salido del catálogo o que el enlace esté
          incompleto. Te dejamos por dónde seguir.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-2.5">
          <Link href="/" className={cn(buttonVariants({ size: "lg" }))}>
            Ir al inicio
          </Link>
          <Link href="/tienda/" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Ver toda la tienda
          </Link>
        </div>
      </div>
    </div>
  );
}
