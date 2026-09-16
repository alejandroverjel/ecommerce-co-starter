"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";

import { calcularEnvio, faltaParaEnvioGratis, type ConfigTienda } from "@/lib/envio";
import { TOPE_UNIDADES, calcularSubtotal, useCarrito } from "@/lib/stores/carrito";
import { formatearCOP } from "@/lib/formato";
import { useMontado } from "@/lib/hooks/usar-montado";
import type { ProductoComplemento } from "@/lib/data/catalogo";
import { SugerenciasCarrito } from "@/components/carrito/sugerencias-carrito";

export function VistaCarrito({
  config,
  complementos = [],
}: {
  config: ConfigTienda;
  complementos?: ProductoComplemento[];
}) {
  const montado = useMontado();
  const lineas = useCarrito((e) => e.lineas);
  const cambiarCantidad = useCarrito((e) => e.cambiarCantidad);
  const quitar = useCarrito((e) => e.quitar);

  // El carrito vive en localStorage: en el servidor siempre está vacío.
  // Sin esta guarda se renderiza "carrito vacío" y luego salta al contenido.

  if (!montado) {
    return (
      <div className="mt-10 h-64 animate-pulse rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)]" />
    );
  }

  if (lineas.length === 0) {
    return (
      <div className="tarjeta mx-auto mt-10 max-w-md p-10 text-center">
        <ShoppingBag className="mx-auto size-8 text-[var(--texto-tenue)]" aria-hidden />
        <p className="display mt-4 text-2xl">Todavía no has escogido nada</p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--texto-suave)]">
          Agrega productos antes de continuar.
        </p>
        <Link
          href="/tienda/"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
        >
          Ver la tienda
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    );
  }

  const subtotal = calcularSubtotal(lineas);
  const envio = calcularEnvio(subtotal, config);
  const total = subtotal + envio;
  const falta = faltaParaEnvioGratis(subtotal, config);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_21rem] lg:gap-12">
      <div className="min-w-0">
      <ul className="space-y-4">
        {lineas.map((l) => (
          <li
            key={`${l.productoId}-${l.varianteId ?? "unica"}`}
            className="flex gap-4 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-4"
          >
            <Link
              href={l.ruta}
              className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[var(--fondo-hondo)] sm:size-24"
            >
              {l.imagenUrl ? (
                <Image src={l.imagenUrl} alt="" fill sizes="6rem" className="object-cover" />
              ) : null}
            </Link>

            <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={l.ruta}
                    className="font-medium leading-snug hover:text-[var(--acento)]"
                  >
                    {l.nombre}
                  </Link>
                  <p className="mt-0.5 text-sm text-[var(--texto-tenue)]">
                    {formatearCOP(l.precioCop)} c/u
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => quitar(l.productoId, l.varianteId)}
                  className="shrink-0 rounded-full p-2 text-[var(--texto-tenue)] transition-colors hover:bg-[var(--fondo-hondo)] hover:text-[var(--texto)]"
                >
                  <Trash2 className="size-4" aria-hidden />
                  <span className="solo-lectores">Quitar {l.nombre}</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center rounded-full border">
                  <button
                    type="button"
                    onClick={() =>
                      cambiarCantidad(l.productoId, l.varianteId, l.cantidad - 1)
                    }
                    className="rounded-l-full p-2.5 transition-colors text-primary hover:bg-[var(--fondo-hondo)]"
                  >
                    <Minus className="size-3.5" aria-hidden />
                    <span className="solo-lectores">Quitar uno de {l.nombre}</span>
                  </button>
                  <span className="cifra min-w-8 text-center text-sm tabular-nums">
                    {l.cantidad}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      cambiarCantidad(l.productoId, l.varianteId, l.cantidad + 1)
                    }
                    disabled={l.cantidad >= TOPE_UNIDADES}
                    className="rounded-r-full p-2.5 transition-colors text-primary hover:bg-[var(--fondo-hondo)] disabled:opacity-35"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    <span className="solo-lectores">Agregar uno de {l.nombre}</span>
                  </button>
                </div>

                <p className="cifra text-lg">{formatearCOP(l.precioCop * l.cantidad)}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>

        <SugerenciasCarrito complementos={complementos} />
      </div>

      <aside className="lg:sticky lg:top-32 lg:h-fit">
        <div className="tarjeta p-6">
          <h2 className="display text-xl">Resumen</h2>

          <dl className="mt-5 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--texto-suave)]">Productos</dt>
              <dd className="cifra">{formatearCOP(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--texto-suave)]">Envío</dt>
              <dd className={envio === 0 ? "font-medium text-[var(--disponible)]" : "cifra"}>
                {envio === 0 ? "Gratis" : formatearCOP(envio)}
              </dd>
            </div>
          </dl>

          {/* Cuánto falta para el envío gratis. Es el empujón más efectivo
              del carrito, y solo aparece cuando de verdad falta. */}
          {falta !== null && (
            <p className="mt-4 rounded-xl bg-[var(--fondo-hondo)] px-4 py-3 text-sm leading-relaxed text-[var(--texto-suave)]">
              Te faltan{" "}
              <span className="cifra font-medium text-[var(--texto)]">
                {formatearCOP(falta)}
              </span>{" "}
              para que el envío salga gratis.
            </p>
          )}

          <div className="mt-5 flex items-baseline justify-between border-t pt-5">
            <span className="font-medium">Total</span>
            <span className="cifra text-2xl">{formatearCOP(total)}</span>
          </div>

          <Link
            href="/finalizar-compra/"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3.5 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
          >
            Continuar
            <ArrowRight className="size-4" aria-hidden />
          </Link>

          <Link
            href="/tienda/"
            className="mt-3 block text-center text-sm text-[var(--texto-suave)] hover:text-[var(--acento)]"
          >
            Seguir comprando
          </Link>
        </div>
      </aside>
    </div>
  );
}
