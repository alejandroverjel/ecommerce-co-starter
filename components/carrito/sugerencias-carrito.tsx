"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, Plus } from "lucide-react";

import type { ProductoComplemento } from "@/lib/data/catalogo";
import { useCarrito } from "@/lib/stores/carrito";
import { formatearCOP } from "@/lib/formato";
import { trackearAgregarCarrito } from "@/lib/analitica/eventos";

/**
 * Cross-sell del carrito: "También te puede interesar".
 *
 * Los candidatos se cargan en el servidor (son los productos más económicos
 * con stock) y bajan como prop; aquí se filtran los que ya están en el carrito
 * —eso solo se sabe en el cliente, donde vive el store— y se muestran unos
 * pocos. Agregar uno no navega: el store abre/mantiene el drawer y refresca la
 * lista, así que sumar un producto es un solo toque.
 *
 * Se agrega la variante concreta (viene con varianteId), no una null: dos
 * líneas de la misma variante burlarían el tope de unidades del checkout.
 */
export function SugerenciasCarrito({
  complementos,
  cuantos = 3,
  titulo = "También te puede interesar",
}: {
  complementos: ProductoComplemento[];
  cuantos?: number;
  titulo?: string;
}) {
  const lineas = useCarrito((e) => e.lineas);
  const agregar = useCarrito((e) => e.agregar);
  const [agregado, setAgregado] = useState<string | null>(null);

  // Los que aún no están en el carrito. Se compara por producto: si ya lleva
  // ese producto, no tiene sentido sugerírselo otra vez.
  const enCarrito = new Set(lineas.map((l) => l.productoId));
  const sugeridos = complementos.filter((c) => !enCarrito.has(c.productoId)).slice(0, cuantos);

  if (sugeridos.length === 0) return null;

  function alAgregar(c: ProductoComplemento) {
    agregar({
      productoId: c.productoId,
      varianteId: c.varianteId,
      slug: c.slug,
      nombre: c.nombre,
      precioCop: c.precioCop,
      imagenUrl: c.imagenUrl,
      ruta: c.ruta,
    });
    trackearAgregarCarrito({
      id: c.productoId,
      nombre: c.nombre,
      precioCop: c.precioCop,
      cantidad: 1,
    });
    setAgregado(c.productoId);
    setTimeout(() => setAgregado((v) => (v === c.productoId ? null : v)), 2000);
  }

  return (
    <section aria-labelledby="sugerencias-titulo" className="mt-8">
      <h2
        id="sugerencias-titulo"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--texto-tenue)]"
      >
        {titulo}
      </h2>

      <ul className="mt-3 space-y-2.5">
        {sugeridos.map((c) => (
          <li
            key={c.productoId}
            className="flex items-center gap-3 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-2.5"
          >
            <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-[var(--fondo-hondo)]">
              {c.imagenUrl && (
                <Image
                  src={c.imagenUrl}
                  alt={c.nombre}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.nombre}</p>
              <p className="cifra text-sm text-[var(--texto-suave)]">
                {formatearCOP(c.precioCop)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => alAgregar(c)}
              aria-label={`Agregar ${c.nombre} al carrito`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors hover:border-[var(--acento)] hover:text-[var(--acento)]"
            >
              {agregado === c.productoId ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Añadido
                </>
              ) : (
                <>
                  <Plus className="size-4" aria-hidden />
                  Añadir
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
