import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FormularioPedido } from "@/components/carrito/formulario-pedido";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { leerConfigTienda, leerPasarelasHabilitadas } from "@/lib/data/tienda";
import { enlaceWhatsapp } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Finalizar compra",
  robots: { index: false, follow: false },
};

export default async function FinalizarCompra({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string; pedido?: string }>;
}) {
  const [config, pasarelas, params] = await Promise.all([
    leerConfigTienda(),
    leerPasarelasHabilitadas(),
    searchParams,
  ]);

  // La pasarela devuelve aquí cuando el pago se rechaza (back_url de failure).
  // Sin este aviso el cliente caía en el formulario/carrito sin saber qué pasó
  // y creía que nunca hubo pedido.
  const pagoFallido = params.pago === "fallido";
  const whatsapp = enlaceWhatsapp();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Ruta de navegación">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/carrito/" className="transition-colors hover:text-foreground">
              Carrito
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-foreground">
            Finalizar compra
          </li>
        </ol>
      </nav>

      <h1 className="display mt-5 text-3xl md:text-4xl">Finalizar compra</h1>
      <p className="mt-2 text-muted-foreground">{TIENDA.cobertura.descripcion}.</p>

      <Link
        href="/tienda/"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Seguir comprando
      </Link>

      {pagoFallido && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Tu pago no se completó</AlertTitle>
          <AlertDescription>
            {params.pedido
              ? `El pedido ${params.pedido.slice(0, 24)} quedó guardado. `
              : "Tu pedido quedó guardado. "}
            Puedes intentar de nuevo abajo
            {whatsapp && (
              <>
                {" "}
                o escribirnos por{" "}
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="underline">
                  WhatsApp
                </a>
              </>
            )}
            {" "}y lo resolvemos.
          </AlertDescription>
        </Alert>
      )}

      {/* Aviso propio de la tienda, si lo configuró. Sin TIENDA.checkout.aviso
          no se muestra nada: no todas las tiendas piden confirmar por un
          canal aparte. */}
      {TIENDA.checkout.aviso && (
        <Alert className="mt-6">
          <AlertDescription>{TIENDA.checkout.aviso}</AlertDescription>
        </Alert>
      )}

      <FormularioPedido config={config} pasarelas={pasarelas} />
    </div>
  );
}
