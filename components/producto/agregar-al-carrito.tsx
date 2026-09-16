"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";

import type { ProductoFicha } from "@/lib/data/catalogo";
import { TOPE_UNIDADES, useCarrito } from "@/lib/stores/carrito";
import { formatearCOP } from "@/lib/formato";
import { trackearAgregarCarrito } from "@/lib/analitica/eventos";

export function AgregarAlCarrito({ producto }: { producto: ProductoFicha }) {
  const agregar = useCarrito((e) => e.agregar);

  const [varianteId, setVarianteId] = useState(
    producto.variantes.find((v) => v.disponible)?.id ?? producto.variantes[0]?.id ?? null,
  );
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(false);

  const variante = producto.variantes.find((v) => v.id === varianteId);
  const precio = variante?.precioCop ?? producto.precioCop;
  const hayVariantes = producto.variantes.length > 1;
  const puedeComprar = producto.disponible && (variante?.disponible ?? false);

  function alAgregar() {
    if (!puedeComprar) return;

    agregar(
      {
        productoId: producto.id,
        varianteId,
        slug: producto.slug,
        nombre: producto.nombre,
        precioCop: precio,
        imagenUrl: producto.imagen?.url ?? null,
        ruta: producto.ruta,
      },
      cantidad,
    );

    trackearAgregarCarrito({
      id: producto.id,
      nombre: producto.nombre,
      precioCop: precio,
      cantidad,
    });

    // Confirmación breve en el propio botón: un aviso flotante obligaría a
    // mirar a otra parte de la pantalla.
    setAgregado(true);
    setTimeout(() => setAgregado(false), 2500);
  }

  return (
    <div className="space-y-5">
      {hayVariantes && (
        <fieldset>
          <legend className="text-sm font-medium">Escoge una opción</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {producto.variantes.map((v) => (
              <label
                key={v.id}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors ${
                  varianteId === v.id
                    ? "border-[var(--acento)] bg-[var(--acento)] text-[var(--acento-texto)]"
                    : "!border-[var(--borde-fuerte)] hover:!border-[var(--texto-suave)]"
                } ${!v.disponible ? "cursor-not-allowed opacity-45" : ""}`}
              >
                <input
                  type="radio"
                  name="variante"
                  value={v.id}
                  checked={varianteId === v.id}
                  disabled={!v.disponible}
                  onChange={() => setVarianteId(v.id)}
                  className="solo-lectores"
                />
                {v.nombre}
                {v.precioCop !== producto.precioCop && (
                  <span className="cifra ml-2 opacity-70">{formatearCOP(v.precioCop)}</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-full border !border-[var(--borde-fuerte)]">
          <button
            type="button"
            onClick={() => setCantidad((c) => Math.max(1, c - 1))}
            disabled={cantidad <= 1}
            className="rounded-l-full p-3 transition-colors text-primary hover:bg-[var(--fondo-hondo)] disabled:opacity-35"
          >
            <Minus className="size-4" aria-hidden />
            <span className="solo-lectores">Quitar uno</span>
          </button>

          <span
            aria-live="polite"
            className="cifra min-w-10 text-center text-base tabular-nums"
          >
            {cantidad}
          </span>

          <button
            type="button"
            onClick={() => setCantidad((c) => Math.min(TOPE_UNIDADES, c + 1))}
            disabled={cantidad >= TOPE_UNIDADES}
            className="rounded-r-full p-3 transition-colors text-primary hover:bg-[var(--fondo-hondo)] disabled:opacity-35"
          >
            <Plus className="size-4" aria-hidden />
            <span className="solo-lectores">Agregar uno</span>
          </button>
        </div>

        <button
          type="button"
          onClick={alAgregar}
          disabled={!puedeComprar}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-7 py-3.5 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {agregado ? (
            <>
              <Check className="size-5" aria-hidden />
              Agregado
            </>
          ) : (
            <>
              <ShoppingBag className="size-5" aria-hidden />
              {puedeComprar ? "Agregar al carrito" : "Agotado por ahora"}
            </>
          )}
        </button>
      </div>

      {agregado && (
        <p aria-live="polite" className="text-sm">
          <Link href="/carrito/" className="font-medium text-[var(--acento)] hover:underline">
            Ir al carrito
          </Link>{" "}
          <span className="text-[var(--texto-suave)]">o seguir viendo.</span>
        </p>
      )}
    </div>
  );
}
