"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Buscador de la tienda.
 *
 * Es cliente (no un form GET a secas) para una razón: la "X" nativa del input
 * type="search" limpia el campo pero no reenvía el formulario, así que la URL
 * se quedaba con ?q=... y el listado seguía filtrado. Aquí, al quedar vacío el
 * campo, se vuelve a /tienda/ y se muestran todos los productos.
 */
export function BuscadorTienda({ inicial }: { inicial: string }) {
  const router = useRouter();
  const [valor, setValor] = useState(inicial);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = valor.trim();
    router.push(q ? `/tienda/?q=${encodeURIComponent(q)}` : "/tienda/");
  }

  return (
    <form onSubmit={buscar} className="mt-7 max-w-md">
      <label htmlFor="q" className="solo-lectores">
        Buscar en la tienda
      </label>
      <div className="flex gap-2">
        <input
          id="q"
          name="q"
          type="search"
          value={valor}
          onChange={(e) => {
            const v = e.target.value;
            setValor(v);
            // La X nativa o borrar todo a mano deja el campo vacío: se vuelve
            // al catálogo completo sin tener que pulsar "Buscar".
            if (v === "") router.push("/tienda/");
          }}
          placeholder="Buscar productos…"
          className="min-w-0 flex-1 rounded-full border bg-[var(--fondo-elevado)] px-5 py-3 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]"
        />
        <Button type="submit" size="lg" className="h-auto rounded-full px-6 py-3">
          Buscar
        </Button>
      </div>
    </form>
  );
}
