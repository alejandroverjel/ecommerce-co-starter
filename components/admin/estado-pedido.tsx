"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Undo2 } from "lucide-react";

import {
  MEDIOS_COBRO,
  transicionesDe,
  type Transicion,
} from "@/lib/admin/estados-pedido";
import {
  cambiarEstadoPedido,
  registrarPagoManual,
} from "@/lib/admin/acciones-pedido";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import { leerImporte } from "@/lib/dinero";
import { formatearCifra, formatearCOP } from "@/lib/formato";

/**
 * Cambio de estado del pedido.
 *
 * Solo pinta las transiciones que la máquina permite desde el estado actual:
 * un pedido entregado no muestra "cancelar" porque no existe ese camino. La
 * comprobación de verdad está en el servidor —una server action es un POST y
 * se puede invocar sin pasar por aquí— pero un botón que solo puede fallar es
 * una trampa para quien trabaja con esto todos los días.
 *
 * `compacto` es la variante de la ruta del día: solo los avances, sin
 * correcciones ni reembolsos. Ahí lo único que se hace es empujar el pedido
 * hacia adelante; lo delicado se hace en el detalle, con todo a la vista.
 */

const CLASE_AVANCE =
  "inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-4 py-2 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-50";

const CLASE_SECUNDARIO =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium text-[var(--texto-suave)] transition-colors hover:bg-[var(--fondo-hondo)] disabled:opacity-50";

const CLASE_PELIGRO =
  "inline-flex items-center gap-2 rounded-full border border-[var(--peligro-borde)] px-4 py-2 text-sm font-medium text-[var(--peligro)] transition-colors hover:bg-[var(--peligro-fondo)] disabled:opacity-50";

const CLASE_CAMPO =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-3.5 py-2 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

function Aviso({ resultado }: { resultado: ResultadoAccion | undefined }) {
  if (!resultado) return null;

  if (!resultado.ok) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-3.5 py-2.5 text-sm text-[var(--peligro)]"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {resultado.error}
      </p>
    );
  }

  if (!resultado.mensaje) return null;

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl bg-[var(--exito)]/15 px-3.5 py-2.5 text-sm text-[var(--disponible)]"
    >
      <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
      {resultado.mensaje}
    </p>
  );
}

/** Botón de envío que sabe solo si su formulario está en vuelo. */
function BotonEnvio({
  clase,
  children,
  destino,
  trabajando,
}: {
  clase: string;
  children: React.ReactNode;
  destino?: string;
  trabajando: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={destino ? "destino" : undefined}
      value={destino}
      disabled={pending}
      className={clase}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {trabajando}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Transición sin vuelta: se confirma en dos pasos, sin diálogo del navegador. */
function BotonPeligro({
  pedidoId,
  transicion,
  accion,
}: {
  pedidoId: string;
  transicion: Transicion;
  accion: (datos: FormData) => void;
}) {
  const [armado, setArmado] = useState(false);

  if (!armado) {
    return (
      <button
        type="button"
        onClick={() => setArmado(true)}
        className={CLASE_PELIGRO}
      >
        {transicion.etiqueta}
      </button>
    );
  }

  return (
    <form action={accion} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <span className="text-sm text-[var(--texto-suave)]">
        {transicion.ayuda} ¿Seguro?
      </span>
      <BotonEnvio clase={CLASE_PELIGRO} destino={transicion.destino} trabajando="…">
        Sí, {transicion.etiqueta.toLowerCase()}
      </BotonEnvio>
      <button
        type="button"
        onClick={() => setArmado(false)}
        className="text-sm text-[var(--texto-tenue)] underline"
      >
        No
      </button>
    </form>
  );
}

/** Formulario del cobro a mano. Sin monto y sin medio no se registra nada. */
function FormularioCobro({
  pedidoId,
  totalCop,
  accion,
}: {
  pedidoId: string;
  totalCop: number;
  accion: (datos: FormData) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [montoEscrito, setMontoEscrito] = useState(() => formatearCifra(totalCop));

  /**
   * El servidor rechaza un cobro que no cuadre con el total salvo que venga
   * la casilla `confirmarDescuadre`. La casilla solo aparece cuando el monto
   * tecleado de verdad difiere: mostrarla siempre invita a marcarla por
   * costumbre, y ahí el aviso deja de avisar.
   */
  const lecturaMonto = leerImporte(montoEscrito);
  const descuadra = lecturaMonto.ok && lecturaMonto.pesos !== totalCop;

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className={CLASE_AVANCE}>
        Registrar pago
      </button>
    );
  }

  return (
    <form action={accion} className="w-full space-y-3 rounded-xl border p-4">
      <input type="hidden" name="pedidoId" value={pedidoId} />

      <p className="text-sm font-medium">Registrar un cobro fuera de la pasarela</p>
      <p className="text-xs text-[var(--texto-suave)]">
        Queda escrito en los pagos del pedido, no solo como una fecha suelta: así
        se puede cuadrar contra la caja o el banco.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="medio" className="text-xs font-medium">
            Por dónde entró
          </label>
          <select id="medio" name="medio" required defaultValue="efectivo" className={CLASE_CAMPO}>
            {MEDIOS_COBRO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="monto" className="text-xs font-medium">
            Cuánto se cobró
          </label>
          {/* Se precarga el total del pedido, pero se deja editar: un abono o
              un cobro descuadrado hay que poder registrarlo tal como pasó. */}
          <input
            id="monto"
            name="monto"
            inputMode="numeric"
            required
            value={montoEscrito}
            onChange={(e) => setMontoEscrito(e.target.value)}
            className={CLASE_CAMPO}
          />
          <span className="text-xs text-[var(--texto-tenue)]">
            El pedido vale {formatearCOP(totalCop)}
          </span>
        </div>
      </div>

      {descuadra && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--aviso)]/40 bg-[var(--aviso)]/10 p-3 text-sm">
          <input
            type="checkbox"
            name="confirmarDescuadre"
            className="mt-0.5 size-4 accent-[var(--acento)]"
          />
          <span>
            El monto no coincide con el total del pedido y es correcto
            <span className="block text-xs text-[var(--texto-suave)]">
              Un abono, propina o redondeo del efectivo. Sin marcar esto, el
              cobro descuadrado no se registra.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="referencia" className="text-xs font-medium">
          Referencia <span className="text-[var(--texto-tenue)]">(opcional)</span>
        </label>
        <input
          id="referencia"
          name="referencia"
          placeholder="Número de la transferencia, comprobante…"
          className={CLASE_CAMPO}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nota" className="text-xs font-medium">
          Nota <span className="text-[var(--texto-tenue)]">(opcional)</span>
        </label>
        <input id="nota" name="nota" className={CLASE_CAMPO} />
      </div>

      <div className="flex items-center gap-3">
        <BotonEnvio clase={CLASE_AVANCE} trabajando="Registrando…">
          Registrar y marcar pagado
        </BotonEnvio>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-sm text-[var(--texto-tenue)] underline"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function SelectorEstado({
  pedidoId,
  estado,
  totalCop,
  compacto = false,
}: {
  pedidoId: string;
  estado: string;
  totalCop: number;
  compacto?: boolean;
}) {
  const [resultadoEstado, accionEstado] = useActionState<
    ResultadoAccion | undefined,
    FormData
  >(cambiarEstadoPedido, undefined);

  const [resultadoCobro, accionCobro] = useActionState<
    ResultadoAccion | undefined,
    FormData
  >(registrarPagoManual, undefined);

  const todas = transicionesDe(estado);
  const disponibles = compacto ? todas.filter((t) => t.tono === "avance") : todas;

  const cobro = disponibles.find((t) => t.destino === "pagado" && t.dinero);
  const avances = disponibles.filter((t) => t.tono === "avance" && t !== cobro);
  const correcciones = disponibles.filter((t) => t.tono === "correccion");
  const peligrosas = disponibles.filter((t) => t.tono === "peligro");

  const sinNada = disponibles.length === 0;

  return (
    <div className="space-y-3">
      {sinNada && !compacto && (
        <p className="text-sm text-[var(--texto-tenue)]">
          Este pedido está en un estado final: desde aquí ya no se mueve.
        </p>
      )}

      {avances.length > 0 && (
        <form action={accionEstado} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="pedidoId" value={pedidoId} />
          {avances.map((t) => (
            <BotonEnvio
              key={t.destino}
              clase={CLASE_AVANCE}
              destino={t.destino}
              trabajando="Guardando…"
            >
              {t.etiqueta}
            </BotonEnvio>
          ))}
        </form>
      )}

      {cobro && (
        <FormularioCobro
          pedidoId={pedidoId}
          totalCop={totalCop}
          accion={accionCobro}
        />
      )}

      {correcciones.length > 0 && (
        <form action={accionEstado} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="pedidoId" value={pedidoId} />
          {correcciones.map((t) => (
            <BotonEnvio
              key={t.destino}
              clase={CLASE_SECUNDARIO}
              destino={t.destino}
              trabajando="Guardando…"
            >
              <Undo2 className="size-3.5" aria-hidden />
              {t.etiqueta}
            </BotonEnvio>
          ))}
        </form>
      )}

      {peligrosas.map((t) => (
        <BotonPeligro
          key={t.destino}
          pedidoId={pedidoId}
          transicion={t}
          accion={accionEstado}
        />
      ))}

      <Aviso resultado={resultadoEstado} />
      <Aviso resultado={resultadoCobro} />
    </div>
  );
}
