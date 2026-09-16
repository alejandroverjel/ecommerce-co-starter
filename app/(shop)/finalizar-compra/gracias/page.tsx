import type { Metadata } from "next";
import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";

import { CONTACTO, enlaceWhatsapp } from "@/lib/sitio";
import { leerReciboFirmado } from "@/lib/pagos/recibo";
import { formatearCOP } from "@/lib/formato";
import { SeguimientoCompra } from "@/components/analitica/seguimiento-compra";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pedido confirmado",
  robots: { index: false, follow: false },
};

/**
 * Confirmación.
 *
 * Solo muestra el número de pedido que viene en la URL. NO consulta la base
 * con ese número a propósito: los números son secuenciales (ORD-001000,
 * ORD-001001…) y cualquiera podría recorrerlos para leer los datos de otros
 * clientes. Ver el detalle de un pedido exige estar autenticado.
 */
export default async function Gracias({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string; total?: string; firma?: string }>;
}) {
  const { pedido, total, firma } = await searchParams;

  // Se acota lo que se pinta: el parámetro viene de la URL y es texto de
  // terceros hasta que se demuestre lo contrario.
  const numero = pedido?.trim().slice(0, 24) ?? null;

  // El total solo se muestra si su firma cuadra. Editar `total` en la barra de
  // direcciones no cambia lo que se pinta: la firma deja de validar y no se
  // muestra nada. Ver lib/pagos/recibo.ts.
  const totalCop = leerReciboFirmado(numero, total ?? null, firma ?? null);

  const whatsapp = enlaceWhatsapp(numero ? `mi pedido ${numero}` : undefined);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 md:py-24">
      {/* Conversión: solo cuando hay pedido y un total verificado por firma. */}
      {numero && totalCop !== null && (
        <SeguimientoCompra pedido={numero} totalCop={totalCop} />
      )}
      <div className="tarjeta p-8 text-center sm:p-12">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--disponible)]/12">
          <Check className="size-7 text-[var(--disponible)]" aria-hidden />
        </div>

        <h1 className="display mt-6 text-3xl md:text-4xl">Recibimos tu pedido</h1>

        {/* Número y total en `.cifra` (Inter 700): es la convención del sitio
            para todo lo que sea una cifra, y aquí son los dos datos que la
            persona copia o compara. */}
        {numero && <p className="cifra mt-4 text-2xl">{numero}</p>}

        {/* La cifra que de verdad quedó grabada. Sin esto, quien paga contra
            entrega no la veía hasta que el mensajero estaba en la puerta. */}
        {totalCop !== null && (
          <p className="mt-3 text-muted-foreground">
            Total: <span className="cifra">{formatearCOP(totalCop)}</span>
          </p>
        )}

        <p className="mt-5 leading-relaxed text-muted-foreground">
          {whatsapp
            ? "Te escribimos por WhatsApp para confirmar la entrega y coordinar el pago. Guarda este número por si necesitas escribirnos."
            : "Estamos preparando tu pedido. Guarda este número por si necesitas escribirnos."}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "lg" }))}
            >
              <MessageCircle className="size-4" aria-hidden />
              Escribirnos por WhatsApp
            </a>
          )}
          <Link href="/tienda/" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Seguir viendo
          </Link>
        </div>

        {CONTACTO.telefono && (
          <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">
            ¿Algo no cuadra? Llámanos al{" "}
            <a href={`tel:${CONTACTO.telefonoInternacional}`} className="font-medium text-foreground hover:text-primary">
              {CONTACTO.telefonoFormateado}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
