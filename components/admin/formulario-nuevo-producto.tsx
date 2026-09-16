"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";

import { crearProducto } from "@/lib/admin/acciones-producto";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import type { CategoriaAdmin } from "@/lib/data/admin";
import { ESTADOS_PRODUCTO } from "@/lib/validaciones/producto";
import { SubirImagen } from "@/components/admin/subir-imagen";

const CAMPO =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="text-xs text-[var(--texto-tenue)]">{ayuda}</p>}
    </div>
  );
}

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-2.5 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Creando…
        </>
      ) : (
        "Crear producto"
      )}
    </button>
  );
}

export function FormularioNuevoProducto({ categorias }: { categorias: CategoriaAdmin[] }) {
  const [resultado, accion] = useActionState<ResultadoAccion | undefined, FormData>(
    crearProducto,
    undefined,
  );

  return (
    <form action={accion} className="bloque space-y-5 p-6 sm:p-7">
      {resultado && !resultado.ok && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {resultado.error}
        </p>
      )}

      <Campo id="nombre" etiqueta="Nombre del producto" ayuda="La URL se genera sola a partir del nombre.">
        <input id="nombre" name="nombre" required className={CAMPO} />
      </Campo>

      <Campo id="categoriaId" etiqueta="Categoría">
        <select id="categoriaId" name="categoriaId" defaultValue="" className={CAMPO}>
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </Campo>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id="precioCop" etiqueta="Precio" ayuda="En pesos. Ej: 60.000">
          <input id="precioCop" name="precioCop" inputMode="numeric" required className={CAMPO} />
        </Campo>
        <Campo id="stock" etiqueta="Stock" ayuda="Unidades disponibles.">
          <input id="stock" name="stock" inputMode="numeric" required defaultValue="0" className={CAMPO} />
        </Campo>
      </div>

      <Campo id="descripcion" etiqueta="Descripción (opcional)" ayuda="Texto plano. El formato con HTML se ajusta después en la ficha.">
        <textarea id="descripcion" name="descripcion" rows={4} className={CAMPO} />
      </Campo>

      <SubirImagen name="imagenUrl" destino="producto" etiqueta="Foto principal (opcional)" />

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id="estado" etiqueta="Estado" ayuda="Empieza en borrador para revisarlo antes de publicar.">
          <select id="estado" name="estado" defaultValue="borrador" className={CAMPO}>
            {ESTADOS_PRODUCTO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <label className="mt-7 flex cursor-pointer items-center gap-3 rounded-xl border p-3">
          <input type="checkbox" name="destacado" className="size-4 accent-[var(--acento)]" />
          <span className="text-sm font-medium">Destacado (aparece en la portada)</span>
        </label>
      </div>

      <p className="text-xs text-[var(--texto-tenue)]">
        Se crea como producto simple, de una sola presentación. Si tiene varios tamaños o precios,
        créalo así y agrégale las presentaciones después, en la ficha.
      </p>

      <Boton />
    </form>
  );
}
