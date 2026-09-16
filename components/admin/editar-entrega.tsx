"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Pencil } from "lucide-react";

import { editarEntregaPedido } from "@/lib/admin/acciones-pedido";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import { FRANJAS, MUNICIPIOS } from "@/lib/validaciones/pedido";

const CAMPO =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-3.5 py-2 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

export type DatosEntregaEditable = {
  pedidoId: string;
  fechaEntrega: string | null;
  franja: string | null;
  destinatario: string | null;
  telefonoDestinatario: string | null;
  ciudad: string | null;
  direccion: string | null;
  indicaciones: string | null;
};

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-5 py-2 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Guardando…
        </>
      ) : (
        "Guardar cambios"
      )}
    </button>
  );
}

export function EditarEntrega({ datos }: { datos: DatosEntregaEditable }) {
  const [abierto, setAbierto] = useState(false);
  const [resultado, accion] = useActionState<ResultadoAccion | undefined, FormData>(
    editarEntregaPedido,
    undefined,
  );

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="print:hidden mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-[var(--texto-suave)] transition-colors hover:bg-[var(--fondo-hondo)]"
      >
        <Pencil className="size-3.5" aria-hidden />
        Editar datos de entrega
      </button>
    );
  }

  return (
    <form action={accion} className="print:hidden mt-4 space-y-3 rounded-xl border p-4">
      <input type="hidden" name="pedidoId" value={datos.pedidoId} />
      <p className="text-sm font-medium">Editar datos de entrega</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Fecha
          <input
            type="date"
            name="fechaEntrega"
            defaultValue={datos.fechaEntrega ?? ""}
            required
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Franja
          <select
            name="franja"
            defaultValue={datos.franja ?? FRANJAS[0].valor}
            className={CAMPO}
          >
            {FRANJAS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
            {datos.franja && !FRANJAS.some((f) => f.valor === datos.franja) && (
              <option value={datos.franja}>{datos.franja} (franja anterior)</option>
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Recibe
          <input name="destinatario" defaultValue={datos.destinatario ?? ""} required className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Teléfono de quien recibe
          <input
            name="telefonoDestinatario"
            inputMode="numeric"
            defaultValue={datos.telefonoDestinatario ?? ""}
            required
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Municipio
          <select name="ciudad" defaultValue={datos.ciudad ?? MUNICIPIOS[0]} className={CAMPO}>
            {MUNICIPIOS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Dirección
          <input name="direccion" defaultValue={datos.direccion ?? ""} required className={CAMPO} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Indicaciones (opcional)
        <input name="indicaciones" defaultValue={datos.indicaciones ?? ""} className={CAMPO} />
      </label>

      {resultado && !resultado.ok && (
        <p role="alert" className="flex items-start gap-2 text-sm text-[var(--peligro)]">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {resultado.error}
        </p>
      )}
      {resultado?.ok && resultado.mensaje && (
        <p role="status" className="flex items-start gap-2 text-sm text-[var(--disponible)]">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {resultado.mensaje}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Boton />
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-sm text-[var(--texto-tenue)] underline"
        >
          Cerrar
        </button>
      </div>
    </form>
  );
}
