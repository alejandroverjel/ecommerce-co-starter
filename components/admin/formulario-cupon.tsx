"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";

import {
  crearCupon,
  guardarCupon,
  eliminarCupon,
} from "@/lib/admin/acciones-cupon";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import type { FichaCuponAdmin } from "@/lib/data/cupones-admin";
import { TIPOS_CUPON } from "@/lib/validaciones/cupon";
import { TIENDA } from "@/tienda.config";

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

/** Date → "AAAA-MM-DD" en Bogotá, para precargar los input[type=date]. */
function aFechaInput(fecha: Date | null): string {
  if (!fecha) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIENDA.ubicacion.zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

export function FormularioCupon({ cupon }: { cupon?: FichaCuponAdmin | null }) {
  const esNuevo = !cupon;
  const [resultado, accion] = useActionState<ResultadoAccion | undefined, FormData>(
    esNuevo ? crearCupon : guardarCupon,
    undefined,
  );

  const [tipo, setTipo] = useState(cupon?.type ?? "porcentaje");

  const valorInicial =
    cupon == null || cupon.type === "envio_gratis"
      ? ""
      : cupon.type === "porcentaje"
        ? String(cupon.value / 100)
        : String(cupon.value);

  return (
    <>
      <form action={accion} className="bloque space-y-5 p-6 sm:p-7">
        {!esNuevo && <input type="hidden" name="id" value={cupon!.id} />}

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="code" etiqueta="Código" ayuda="Lo que teclea el cliente. Sin espacios. Ej: BIENVENIDA10">
            <input id="code" name="code" defaultValue={cupon?.code ?? ""} required className={`${CAMPO} uppercase`} />
          </Campo>

          <Campo id="type" etiqueta="Tipo de descuento">
            <select
              id="type"
              name="type"
              defaultValue={cupon?.type ?? "porcentaje"}
              onChange={(e) => setTipo(e.target.value)}
              className={CAMPO}
            >
              {TIPOS_CUPON.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        {tipo !== "envio_gratis" && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo
              id="valorCrudo"
              etiqueta={tipo === "porcentaje" ? "Porcentaje" : "Monto del descuento"}
              ayuda={tipo === "porcentaje" ? "Entre 1 y 100. Ej: 20 para 20 %." : "En pesos. Ej: 15000."}
            >
              <input id="valorCrudo" name="valorCrudo" inputMode="decimal" defaultValue={valorInicial} className={CAMPO} />
            </Campo>

            {tipo === "porcentaje" && (
              <Campo id="maxDiscountCop" etiqueta="Tope de descuento (opcional)" ayuda="Máximo en pesos que puede descontar. Vacío = sin tope.">
                <input
                  id="maxDiscountCop"
                  name="maxDiscountCop"
                  inputMode="numeric"
                  defaultValue={cupon?.maxDiscountCop != null ? String(cupon.maxDiscountCop) : ""}
                  className={CAMPO}
                />
              </Campo>
            )}
          </div>
        )}

        <Campo id="description" etiqueta="Nota interna (opcional)" ayuda="Para reconocerlo en el panel. No se muestra al cliente.">
          <input id="description" name="description" defaultValue={cupon?.description ?? ""} className={CAMPO} />
        </Campo>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="minSubtotalCop" etiqueta="Subtotal mínimo (opcional)" ayuda="Solo aplica desde este monto en productos. Vacío = sin mínimo.">
            <input
              id="minSubtotalCop"
              name="minSubtotalCop"
              inputMode="numeric"
              defaultValue={cupon?.minSubtotalCop ? String(cupon.minSubtotalCop) : ""}
              className={CAMPO}
            />
          </Campo>

          <Campo id="usageLimit" etiqueta="Límite de usos total (opcional)" ayuda="Cuántas veces puede usarse en total. Vacío = ilimitado.">
            <input
              id="usageLimit"
              name="usageLimit"
              inputMode="numeric"
              defaultValue={cupon?.usageLimit != null ? String(cupon.usageLimit) : ""}
              className={CAMPO}
            />
          </Campo>

          <Campo id="usageLimitPerUser" etiqueta="Límite por persona (opcional)" ayuda="Veces que un mismo correo puede usarlo. Vacío = sin límite.">
            <input
              id="usageLimitPerUser"
              name="usageLimitPerUser"
              inputMode="numeric"
              defaultValue={cupon?.usageLimitPerUser != null ? String(cupon.usageLimitPerUser) : ""}
              className={CAMPO}
            />
          </Campo>

          <div />

          <Campo id="startsAt" etiqueta="Vigente desde (opcional)" ayuda="Vacío = desde ya.">
            <input id="startsAt" name="startsAt" type="date" defaultValue={aFechaInput(cupon?.startsAt ?? null)} className={CAMPO} />
          </Campo>

          <Campo id="endsAt" etiqueta="Vigente hasta (opcional)" ayuda="Incluye el día entero. Vacío = sin vencimiento.">
            <input id="endsAt" name="endsAt" type="date" defaultValue={aFechaInput(cupon?.endsAt ?? null)} className={CAMPO} />
          </Campo>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-4">
          <input type="checkbox" name="isActive" defaultChecked={cupon?.isActive ?? true} className="size-4 accent-[var(--acento)]" />
          <span className="text-sm font-medium">Activo (se puede usar en el checkout)</span>
        </label>

        <div className="space-y-4">
          <Aviso resultado={resultado} />
          <Boton texto={esNuevo ? "Crear cupón" : "Guardar cambios"} cargando="Guardando…" />
        </div>
      </form>

      {!esNuevo && <ZonaPeligroCupon cupon={cupon!} />}
    </>
  );
}

function ZonaPeligroCupon({ cupon }: { cupon: FichaCuponAdmin }) {
  const [resultado, accion] = useActionState<ResultadoAccion | undefined, FormData>(
    eliminarCupon,
    undefined,
  );
  const [armado, setArmado] = useState(false);

  // Un cupón ya usado no se borra (rompería el historial): se desactiva.
  if (cupon.usos > 0) {
    return (
      <p className="mt-6 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-5 text-sm text-[var(--texto-suave)]">
        Este cupón se usó en {cupon.usos} {cupon.usos === 1 ? "pedido" : "pedidos"}, así que no se
        puede borrar sin perder ese historial. Para retirarlo, desmárcalo como activo arriba.
      </p>
    );
  }

  return (
    <div className="mt-6 rounded-[var(--radius-tarjeta)] border border-[var(--peligro-borde)] p-5">
      <h2 className="text-sm font-semibold text-[var(--peligro)]">Eliminar cupón</h2>
      <p className="mt-1 text-sm text-[var(--texto-suave)]">
        Nunca se ha usado, así que se puede borrar del todo.
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
          <input type="hidden" name="id" value={cupon.id} />
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
