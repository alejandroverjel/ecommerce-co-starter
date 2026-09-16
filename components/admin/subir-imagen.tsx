"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, X } from "lucide-react";

import { subirImagen } from "@/lib/admin/acciones-imagen";

/**
 * Campo de subida de imagen para el panel.
 *
 * Sube al volumen persistente y deja la RUTA resultante en un input hidden con
 * el `name` dado, así el formulario que lo contiene la manda como un campo de
 * texto más —sin cambiar las acciones, que ya esperan una ruta—. Muestra la
 * imagen actual y permite reemplazarla o quitarla.
 */
export function SubirImagen({
  name,
  destino = "producto",
  valorInicial = "",
  etiqueta,
}: {
  name: string;
  destino?: "producto" | "campana";
  valorInicial?: string;
  etiqueta: string;
}) {
  const [url, setUrl] = useState(valorInicial);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;

    setCargando(true);
    setError(null);
    try {
      const datos = new FormData();
      datos.set("archivo", archivo);
      datos.set("destino", destino);
      const r = await subirImagen(datos);
      if (r.ok) setUrl(r.url);
      else setError(r.error);
    } catch {
      setError("No se pudo subir la imagen.");
    } finally {
      setCargando(false);
      // Permite volver a elegir el mismo archivo si hizo falta reintentar.
      if (inputFile.current) inputFile.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{etiqueta}</span>
      {/* La ruta viaja al formulario como un campo de texto normal. */}
      <input type="hidden" name={name} value={url} />

      {url ? (
        <div className="flex items-center gap-3">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-lg border bg-[var(--fondo-hondo)]">
            <Image src={url} alt="" fill sizes="80px" className="object-cover" />
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => inputFile.current?.click()}
              disabled={cargando}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--fondo-hondo)] disabled:opacity-50"
            >
              {cargando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ImagePlus className="size-3.5" aria-hidden />}
              Reemplazar
            </button>
            <button
              type="button"
              onClick={() => setUrl("")}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--texto-tenue)] underline"
            >
              <X className="size-3.5" aria-hidden />
              Quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputFile.current?.click()}
          disabled={cargando}
          className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm text-[var(--texto-suave)] transition-colors hover:border-[var(--acento)] hover:text-[var(--acento)] disabled:opacity-50"
        >
          {cargando ? (
            <>
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Subiendo…
            </>
          ) : (
            <>
              <ImagePlus className="size-5" aria-hidden />
              Subir imagen
            </>
          )}
        </button>
      )}

      <input
        ref={inputFile}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={alElegir}
        className="hidden"
      />
      {error && <p role="alert" className="text-xs text-[var(--peligro)]">{error}</p>}
    </div>
  );
}
