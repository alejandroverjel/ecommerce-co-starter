import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { abandonedCarts } from "@/lib/db/schema";
import { enlaceValido } from "@/lib/carrito/token";
import { RestaurarCarrito } from "@/components/carrito/restaurar-carrito";
import type { LineaGuardada } from "@/lib/data/carrito-abandonado";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Destino del botón "Terminar mi compra" del correo de carrito abandonado.
 *
 * Verifica la firma en el SERVIDOR y, si cuadra, entrega las líneas al cliente
 * para que rearme el carrito y siga al checkout. Funciona en cualquier
 * dispositivo: el carrito no sale de localStorage, sale de la base.
 */

export const metadata: Metadata = {
  title: "Recuperar carrito",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RecuperarCarrito({
  searchParams,
}: {
  searchParams: Promise<{ correo?: string; firma?: string }>;
}) {
  const { correo, firma } = await searchParams;

  const filas = enlaceValido("recuperar", correo, firma)
    ? await db
        .select({ items: abandonedCarts.items })
        .from(abandonedCarts)
        .where(eq(abandonedCarts.email, correo!.trim().toLowerCase()))
        .limit(1)
    : [];

  const lineas = (filas[0]?.items ?? []) as LineaGuardada[];

  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      {lineas.length > 0 ? (
        <>
          <h1 className="display text-3xl">Un momento…</h1>
          <div className="mt-3">
            <RestaurarCarrito lineas={lineas} />
          </div>
        </>
      ) : (
        <>
          <h1 className="display text-3xl">Ese enlace ya no sirve</h1>
          <p className="mt-3 text-muted-foreground">
            Puede que ya hayas terminado la compra o que el enlace esté
            incompleto. Escoge de nuevo en la tienda; te tomará un minuto.
          </p>
          <Link href="/tienda/" className={cn(buttonVariants({ size: "lg" }), "mt-6")}>
            Ir a la tienda
          </Link>
        </>
      )}
    </div>
  );
}
