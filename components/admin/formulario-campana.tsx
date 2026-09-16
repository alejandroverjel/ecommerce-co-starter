"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";

import {
  crearCampana,
  guardarCampana,
  eliminarCampana,
} from "@/lib/admin/acciones-campana";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import type { FichaCampanaAdmin } from "@/lib/data/campanas-admin";
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

function Boton({ texto, cargando }: { texto: string; cargando: string }) {
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
          {cargando}
        </>
      ) : (
        texto
      )}
    </button>
  );
}

function Aviso({ resultado }: { resultado: ResultadoAccion | undefined }) {
  if (!resultado) return null;
  if (!resultado.ok) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {resultado.error}
      </p>
    );
  }
  if (!resultado.mensaje) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl bg-[var(--exito)]/15 px-4 py-3 text-sm text-[var(--disponible)]">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      {resultado.mensaje}
    </p>
  );
}

export function FormularioCampana({ campana }: { campana?: FichaCampanaAdmin | null }) {
  const esNueva = !campana;
  const [resultado, accion] = useActionState<ResultadoAccion | undefined, FormData>(
    esNueva ? crearCampana : guardarCampana,
    undefined,
  );

  // Vista previa del color en vivo, para no adivinar el hexadecimal.
  const [color, setColor] = useState(campana?.colorFondo ?? "#F4F4F5");
  const colorValido = /^#[0-9A-Fa-f]{6}$/.test(color);

  return (
    <>
      <form action={accion} className="bloque space-y-5 p-6 sm:p-7">
        {!esNueva && <input type="hidden" name="id" value={campana!.id} />}

        <Campo id="nombre" etiqueta="Nombre interno" ayuda="Para reconocerla en el panel. No se muestra al cliente.">
          <input id="nombre" name="nombre" defaultValue={campana?.nombre ?? ""} required className={CAMPO} />
        </Campo>

        <Campo id="titulo" etiqueta="Título" ayuda="El titular que ve el cliente en la portada.">
          <input id="titulo" name="titulo" defaultValue={campana?.titulo ?? ""} required className={CAMPO} />
        </Campo>

        <Campo id="cuerpo" etiqueta="Texto" ayuda="Un párrafo. Los saltos de línea se respetan.">
          <textarea id="cuerpo" name="cuerpo" defaultValue={campana?.cuerpo ?? ""} required rows={4} className={CAMPO} />
        </Campo>

        <div className="grid gap-5 sm:grid-cols-2">
          <SubirImagen
            name="imagenUrl"
            destino="campana"
            valorInicial={campana?.imagenUrl ?? ""}
            etiqueta="Imagen (escritorio)"
          />
          <SubirImagen
            name="imagenMovilUrl"
            destino="campana"
            valorInicial={campana?.imagenMovilUrl ?? ""}
            etiqueta="Imagen (móvil, opcional)"
          />
        </div>
        <p className="-mt-2 text-xs text-[var(--texto-tenue)]">
          La de móvil es un recorte cerrado sobre el sujeto. Si la dejas vacía, se usa la de
          escritorio.
        </p>

        <Campo id="imagenAlt" etiqueta="Texto alternativo de la imagen" ayuda="Describe la foto, para buscadores y lectores de pantalla.">
          <input id="imagenAlt" name="imagenAlt" defaultValue={campana?.imagenAlt ?? ""} className={CAMPO} />
        </Campo>

        <Campo id="colorFondo" etiqueta="Color de fondo" ayuda="Hexadecimal, tomado del fondo de la foto. Tapa la franja mientras carga.">
          <div className="flex items-center gap-3">
            <input
              id="colorFondo"
              name="colorFondo"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className={`${CAMPO} flex-1`}
            />
            <span
              aria-hidden
              className="size-10 shrink-0 rounded-lg border"
              style={{ backgroundColor: colorValido ? color : "transparent" }}
            />
          </div>
        </Campo>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="ctaLabel" etiqueta="Texto del botón (opcional)" ayuda="Ej: Ver la tienda. Botón y destino van juntos.">
            <input id="ctaLabel" name="ctaLabel" defaultValue={campana?.ctaLabel ?? ""} className={CAMPO} />
          </Campo>

          <Campo id="ctaHref" etiqueta="Destino del botón (opcional)" ayuda="Ruta del sitio, ej: /tienda/">
            <input id="ctaHref" name="ctaHref" defaultValue={campana?.ctaHref ?? ""} placeholder="/tienda/" className={CAMPO} />
          </Campo>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="inicio" etiqueta="Desde" ayuda="Primer día que se muestra.">
            <input id="inicio" name="inicio" type="date" defaultValue={campana?.inicio ?? ""} required className={CAMPO} />
          </Campo>

          <Campo id="fin" etiqueta="Hasta" ayuda="Último día, incluido.">
            <input id="fin" name="fin" type="date" defaultValue={campana?.fin ?? ""} required className={CAMPO} />
          </Campo>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-4">
          <input type="checkbox" name="activa" defaultChecked={campana?.activa ?? true} className="size-4 accent-[var(--acento)]" />
          <span className="text-sm font-medium">Activa (se muestra en la portada dentro de sus fechas)</span>
        </label>

        <div className="space-y-4">
          <Aviso resultado={resultado} />
          <Boton texto={esNueva ? "Crear campaña" : "Guardar cambios"} cargando="Guardando…" />
        </div>
      </form>

      {!esNueva && <ZonaPeligroCampana id={campana!.id} />}
    </>
  );
}

function ZonaPeligroCampana({ id }: { id: string }) {
  const [resultado, accion] = useActionState<ResultadoAccion | undefined, FormData>(
    eliminarCampana,
    undefined,
  );
  const [armado, setArmado] = useState(false);

  return (
    <div className="mt-6 rounded-[var(--radius-tarjeta)] border border-[var(--peligro-borde)] p-5">
      <h2 className="text-sm font-semibold text-[var(--peligro)]">Eliminar campaña</h2>
      <p className="mt-1 text-sm text-[var(--texto-suave)]">
        Si solo quieres quitarla de la portada, desmárcala como activa arriba: así la conservas para
        el año que viene.
      </p>

      {!armado ? (
        <button
          type="button"
          onClick={() => setArmado(true)}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--peligro-borde)] px-4 py-2 text-sm font-medium text-[var(--peligro)] transition-colors hover:bg-[var(--peligro-fondo)]"
        >
          <Trash2 className="size-4" aria-hidden />
          Eliminar
        </button>
      ) : (
        <form action={accion} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <span className="text-sm text-[var(--texto-suave)]">¿Seguro? No tiene vuelta.</span>
          <BotonEliminar />
          <button type="button" onClick={() => setArmado(false)} className="text-sm text-[var(--texto-tenue)] underline">
            No
          </button>
        </form>
      )}
      <Aviso resultado={resultado} />
    </div>
  );
}

function BotonEliminar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--peligro)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
      Sí, eliminar
    </button>
  );
}
