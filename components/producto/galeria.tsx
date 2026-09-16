"use client";

import Image from "next/image";
import { useState } from "react";

type Foto = { url: string; alt: string; ancho: number | null; alto: number | null };

export function Galeria({ fotos, nombre }: { fotos: Foto[]; nombre: string }) {
  const [activa, setActiva] = useState(0);

  if (fotos.length === 0) {
    return (
      <div className="grid aspect-square place-items-center rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)] text-sm text-[var(--texto-tenue)]">
        Sin foto
      </div>
    );
  }

  const foto = fotos[activa];

  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)] shadow-[var(--sombra-tarjeta)]">
        <Image
          src={foto.url}
          alt={foto.alt}
          fill
          sizes="(min-width: 1024px) 34rem, 100vw"
          priority
          // Next 16.2 emite el preload de `priority` pero NO fetchpriority=high
          // (verificado en el HTML servido): sin esto el navegador trata la
          // imagen LCP como una más y el LCP se va a 4s en 4G lento.
          fetchPriority="high"
          className="object-cover"
        />
      </div>

      {fotos.length > 1 && (
        <ul className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {fotos.map((f, i) => (
            <li key={f.url + i} className="shrink-0">
              <button
                type="button"
                onClick={() => setActiva(i)}
                aria-current={i === activa ? "true" : undefined}
                className={`relative block size-20 overflow-hidden rounded-xl transition-opacity ${
                  i === activa
                    ? "ring-2 ring-[var(--acento)] ring-offset-2 ring-offset-[var(--fondo)]"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                <Image
                  src={f.url}
                  alt=""
                  fill
                  sizes="5rem"
                  className="object-cover"
                />
                <span className="solo-lectores">
                  Ver foto {i + 1} de {nombre}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
