import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { darDeBaja } from "@/lib/data/carrito-abandonado";
import { enlaceValido } from "@/lib/carrito/token";
import { enlaceWhatsapp } from "@/lib/sitio";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Baja de los correos de recuperación, en un clic y sin cuenta.
 *
 * La Ley 1581/2012 exige que quien recibe contenido comercial pueda salirse sin
 * trámite. La firma del enlace impide dar de baja a un tercero escribiendo su
 * correo en la URL.
 *
 * Se da de baja al abrir, sin pedir confirmación: obligar a un segundo clic
 * para dejar de recibir correos es justo el patrón oscuro que esto evita.
 */

export const metadata: Metadata = {
  title: "Baja de correos",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BajaCorreos({
  searchParams,
}: {
  searchParams: Promise<{ correo?: string; firma?: string }>;
}) {
  const { correo, firma } = await searchParams;
  const valido = enlaceValido("baja", correo, firma);
  const whatsapp = enlaceWhatsapp();

  if (valido && correo) {
    try {
      await darDeBaja(correo);
    } catch {
      // Si la base falla, se le dice igual que quedó fuera y se registra: es
      // preferible a mostrarle un error por algo que no puede resolver.
      console.error("baja-correos: no se pudo registrar la baja");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      {valido ? (
        <>
          <CheckCircle2 className="mx-auto size-10 text-[var(--disponible)]" aria-hidden />
          <h1 className="display mt-4 text-3xl">Listo, no te escribimos más</h1>
          <p className="mt-3 text-muted-foreground">
            Dimos de baja <strong>{correo}</strong> de los recordatorios de
            carrito. Los correos de tus pedidos sí seguirán llegando: son parte
            de la compra.
          </p>
        </>
      ) : (
        <>
          <h1 className="display text-3xl">Ese enlace no es válido</h1>
          <p className="mt-3 text-muted-foreground">
            Ábrelo directamente desde el correo que te enviamos.
            {whatsapp && " Si sigues con dudas, escríbenos por WhatsApp y lo hacemos nosotros."}
          </p>
        </>
      )}

      <Link href="/" className={cn(buttonVariants({ size: "lg" }), "mt-6")}>
        Volver al inicio
      </Link>
    </div>
  );
}
