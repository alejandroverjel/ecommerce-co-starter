"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";

import { TOPE_UNIDADES, calcularSubtotal, useCarrito } from "@/lib/stores/carrito";
import { faltaParaEnvioGratis, type ConfigTienda } from "@/lib/envio";
import { formatearCOP } from "@/lib/formato";
import { useMontado } from "@/lib/hooks/usar-montado";
import type { ProductoComplemento } from "@/lib/data/catalogo";
import { SugerenciasCarrito } from "@/components/carrito/sugerencias-carrito";

/**
 * Carrito como panel lateral (drawer) a la derecha.
 *
 * Se abre al agregar un producto o al pulsar el ícono del carrito, sin sacar a
 * la persona de la página. El desglose completo —envío e IVA— sigue viviendo
 * en /carrito; aquí se muestra el subtotal y el empujón de envío gratis, cuyo
 * umbral llega del servidor vía `PanelCarritoServidor` (codificarlo en el
 * cliente es el error que documenta lib/envio.ts). `config` puede ser null
 * (build de CI sin base): en ese caso el empujón no se pinta.
 */
export function PanelCarrito({
  config,
  complementos = [],
}: {
  config: ConfigTienda | null;
  complementos?: ProductoComplemento[];
}) {
  const montado = useMontado();
  const abierto = useCarrito((e) => e.abierto);
  const lineas = useCarrito((e) => e.lineas);
  const cerrar = useCarrito((e) => e.cerrarPanel);
  const cambiarCantidad = useCarrito((e) => e.cambiarCantidad);
  const quitar = useCarrito((e) => e.quitar);
  const ruta = usePathname();

  // Cerrar al navegar: si la persona toca un enlace del panel, no debe quedar
  // abierto sobre la página nueva.
  useEffect(() => {
    cerrar();
  }, [ruta, cerrar]);

  // Esc cierra; y mientras está abierto se bloquea el scroll del fondo.
  useEffect(() => {
    if (!abierto) return;

    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", alTecla);

    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", alTecla);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto, cerrar]);

  // En el servidor y antes de montar no se pinta: el carrito vive en
  // localStorage y renderizarlo causaría un desajuste de hidratación.
  if (!montado || !abierto) return null;

  const subtotal = calcularSubtotal(lineas);
  const vacio = lineas.length === 0;
  // null si ya alcanzó el envío gratis; sin config no se muestra nada.
  const faltante = config ? faltaParaEnvioGratis(subtotal, config) : undefined;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Carrito de compra">
      {/* Telón: oscurece la página y cierra al hacer clic fuera. */}
      <button
        type="button"
        aria-label="Cerrar carrito"
        onClick={cerrar}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[aparecer_0.2s_ease]"
      />

      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-[var(--fondo-elevado)] shadow-[var(--sombra-levanta)] animate-[entrar-derecha_0.25s_ease]">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--borde)] px-5 py-4">
          <h2 className="display text-xl text-[var(--texto)]">Tu carrito</h2>
          <button
            type="button"
            onClick={cerrar}
            className="rounded-full p-2 text-[var(--texto-tenue)] transition-colors hover:bg-[var(--fondo-hondo)] hover:text-[var(--texto)]"
          >
            <X className="size-5" aria-hidden />
            <span className="solo-lectores">Cerrar</span>
          </button>
        </header>

        {vacio ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <ShoppingBag className="size-8 text-[var(--texto-tenue)]" aria-hidden />
            <p className="display text-xl">Todavía no has escogido nada</p>
            <Link
              href="/tienda/"
              onClick={cerrar}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
            >
              Ver la tienda
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-[var(--borde)] overflow-y-auto px-5">
              {lineas.map((l) => (
                <li
                  key={`${l.productoId}-${l.varianteId ?? "unica"}`}
                  className="flex gap-4 py-5"
                >
                  <Link
                    href={l.ruta}
                    onClick={cerrar}
                    className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[var(--fondo-hondo)]"
                  >
                    {l.imagenUrl ? (
                      <Image src={l.imagenUrl} alt="" fill sizes="5rem" className="object-cover" />
                    ) : null}
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={l.ruta}
                        onClick={cerrar}
                        className="font-medium leading-snug hover:text-[var(--acento)] lineas-2"
                      >
                        {l.nombre}
                      </Link>
                      <button
                        type="button"
                        onClick={() => quitar(l.productoId, l.varianteId)}
                        className="shrink-0 rounded-full p-1.5 text-[var(--texto-tenue)] transition-colors hover:bg-[var(--fondo-hondo)] hover:text-[var(--texto)]"
                      >
                        <Trash2 className="size-4" aria-hidden />
                        <span className="solo-lectores">Quitar {l.nombre}</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center rounded-full border border-[var(--borde)]">
                        <button
                          type="button"
                          onClick={() =>
                            cambiarCantidad(l.productoId, l.varianteId, l.cantidad - 1)
                          }
                          className="rounded-l-full p-2 transition-colors text-primary hover:bg-[var(--fondo-hondo)]"
                        >
                          <Minus className="size-3.5" aria-hidden />
                          <span className="solo-lectores">Quitar uno de {l.nombre}</span>
                        </button>
                        <span className="cifra min-w-7 text-center text-sm tabular-nums">
                          {l.cantidad}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            cambiarCantidad(l.productoId, l.varianteId, l.cantidad + 1)
                          }
                          disabled={l.cantidad >= TOPE_UNIDADES}
                          className="rounded-r-full p-2 transition-colors text-primary hover:bg-[var(--fondo-hondo)] disabled:opacity-35"
                        >
                          <Plus className="size-3.5" aria-hidden />
                          <span className="solo-lectores">Agregar uno de {l.nombre}</span>
                        </button>
                      </div>

                      <p className="cifra text-[var(--texto)]">
                        {formatearCOP(l.precioCop * l.cantidad)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Cross-sell: pegado sobre el footer, dentro del área que
                scrollea, para no empujar el botón de pago fuera de vista. */}
            {complementos.length > 0 && (
              <div className="border-t border-[var(--borde)] px-5 pb-2">
                <SugerenciasCarrito complementos={complementos} cuantos={2} />
              </div>
            )}

            <footer className="border-t border-[var(--borde)] px-5 py-5">
              {/* Empujón de envío gratis: el umbral real viene de
                  store_settings (vía PanelCarritoServidor). */}
              {faltante != null && (
                <p className="mb-4 rounded-xl bg-primary/5 px-4 py-2.5 text-center text-sm text-[var(--texto-suave)]">
                  Te faltan{" "}
                  <span className="cifra">{formatearCOP(faltante)}</span> para el
                  envío gratis.
                </p>
              )}
              {faltante === null && (
                <p className="mb-4 rounded-xl bg-[var(--exito)]/10 px-4 py-2.5 text-center text-sm font-medium text-[var(--exito)]">
                  ¡Tu pedido tiene envío gratis!
                </p>
              )}

              <div className="flex items-baseline justify-between">
                <span className="font-medium">Subtotal</span>
                <span className="cifra text-2xl">{formatearCOP(subtotal)}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--texto-tenue)]">
                El envío se calcula al pagar.
              </p>

              <Link
                href="/finalizar-compra/"
                onClick={cerrar}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3.5 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
              >
                Iniciar pago
                <ArrowRight className="size-4" aria-hidden />
              </Link>

              <Link
                href="/carrito/"
                onClick={cerrar}
                className="mt-3 block text-center text-sm text-[var(--texto-suave)] hover:text-[var(--acento)]"
              >
                Ver carrito completo
              </Link>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
