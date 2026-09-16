"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import { guardarAjustesTienda, guardarPasarela } from "@/lib/admin/acciones-ajustes";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import { ETIQUETAS_PASARELA } from "@/lib/validaciones/ajustes";
import { leerImporte } from "@/lib/dinero";
import { calcularEnvio, faltaParaEnvioGratis } from "@/lib/envio";
import { formatearCOP, formatearFecha } from "@/lib/formato";
import { SITIO } from "@/lib/sitio";

/**
 * URL del webhook de cada pasarela integrada, para copiarla al panel del
 * proveedor. Se muestra en la tarjeta porque es el paso que más se olvida: sin
 * el webhook configurado, el cliente paga y el pedido se queda pendiente.
 */
const URL_WEBHOOK: Record<string, string> = {
  mercadopago: `${SITIO.dominio}/api/pagos/mercadopago/`,
  wompi: `${SITIO.dominio}/api/pagos/wompi/`,
};

/**
 * Formularios de ajustes.
 *
 * Estos números no son preferencias: `create_pending_order` los lee para
 * calcular el total de cada pedido. Cambiar el IVA o el envío aquí cambia lo
 * que van a pagar todos los clientes de mañana, así que la pantalla enseña el
 * efecto ANTES de guardar —con un pedido de ejemplo calculado en vivo— y lista
 * campo por campo lo que está a punto de cambiar.
 */

const claseCampo =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

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

function Aviso({ resultado }: { resultado: ResultadoAccion | null }) {
  if (!resultado) return null;

  if (resultado.ok) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl bg-[var(--exito)]/15 px-4 py-3 text-sm text-[var(--disponible)]"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        {resultado.mensaje ?? "Guardado."}
      </p>
    );
  }

  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {resultado.error}
    </p>
  );
}

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

// ============================================================================
// A) Ajustes de la tienda
// ============================================================================

export type AjustesTienda = {
  envioPlanoCop: number;
  umbralEnvioGratisCop: number;
  ivaBps: number;
  minutosReserva: number;
};

/** Lo que se escribe en un campo de pesos, o null si todavía no es un número. */
function pesos(entrada: string): number | null {
  const lectura = leerImporte(entrada);
  return lectura.ok ? lectura.pesos : null;
}

const CAMPOS_QUE_TOCAN_EL_DINERO = new Set([
  "envioPlanoCop",
  "umbralEnvioGratisCop",
  "minutosReserva",
]);

/**
 * Los datos de contacto NO se editan desde el panel.
 *
 * Se probó ponerlos aquí y el control resultaba una mentira: escribían en
 * `store_settings` pero el sitio público los lee de `tienda.config.ts`.
 * Cambiar el WhatsApp desde el panel dejaba el botón flotante marcando el
 * número viejo.
 *
 * Se decidió NO cablearlos en vez de quitar las constantes: el teléfono y el
 * correo aparecen en diez archivos, entre ellos las cuatro páginas legales y
 * los datos estructurados de Google, y un texto legal debe seguir diciendo el
 * número que decía cuando se publicó. Cambian una vez cada varios años; no
 * compensa el riesgo de que un dedazo en un formulario los borre de un
 * contrato.
 *
 * Para cambiarlos, el contacto se edita en tienda.config.ts y se despliega.
 */
export function FormularioAjustes({ ajustes }: { ajustes: AjustesTienda }) {
  const inicial = {
    envioPlanoCop: String(ajustes.envioPlanoCop),
    umbralEnvioGratisCop: String(ajustes.umbralEnvioGratisCop),
    minutosReserva: String(ajustes.minutosReserva),
  };

  const [resultado, accion] = useActionState<ResultadoAccion | null, FormData>(
    guardarAjustesTienda,
    null,
  );
  const [valores, setValores] = useState(inicial);
  const [ejemplo, setEjemplo] = useState("100.000");

  const escribir = (campo: keyof typeof inicial) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  const envio = pesos(valores.envioPlanoCop);
  const umbral = pesos(valores.umbralEnvioGratisCop);
  const subtotal = pesos(ejemplo);

  const config =
    envio !== null && umbral !== null
      ? {
          envioPlanoCop: envio,
          umbralEnvioGratisCop: umbral,
          // El IVA se fija con el seed; no es editable aquí.
          ivaBps: 0,
          minutosReserva: Number(valores.minutosReserva) || 0,
        }
      : null;

  /**
   * Se comparan valores ya interpretados, no las cadenas: escribir "12.000"
   * donde había 12000 no es un cambio y no debe aparecer en la lista.
   */
  const cambios: { campo: string; etiqueta: string; antes: string; ahora: string }[] = [];
  const anotar = (campo: string, etiqueta: string, antes: string, ahora: string) => {
    if (antes !== ahora) cambios.push({ campo, etiqueta, antes, ahora });
  };

  if (envio !== null) {
    anotar("envioPlanoCop", "Envío", formatearCOP(ajustes.envioPlanoCop), formatearCOP(envio));
  }
  if (umbral !== null) {
    anotar(
      "umbralEnvioGratisCop",
      "Envío gratis desde",
      formatearCOP(ajustes.umbralEnvioGratisCop),
      formatearCOP(umbral),
    );
  }
  anotar(
    "minutosReserva",
    "Reserva",
    `${ajustes.minutosReserva} min`,
    `${valores.minutosReserva.trim()} min`,
  );

  const tocaElDinero = cambios.some((c) => CAMPOS_QUE_TOCAN_EL_DINERO.has(c.campo));

  return (
    <form action={accion} className="bloque p-6 sm:p-7">
      <h2 className="display text-xl">Tienda y cobros</h2>
      <p className="mt-1 text-sm text-[var(--texto-suave)]">
        El envío de aquí es el que usa el servidor para calcular cada pedido.
      </p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">

        <Campo id="envioPlanoCop" etiqueta="Envío" ayuda="Pesos enteros. Se puede escribir 12.000.">
          <input
            id="envioPlanoCop"
            name="envioPlanoCop"
            inputMode="numeric"
            value={valores.envioPlanoCop}
            onChange={escribir("envioPlanoCop")}
            className={claseCampo}
          />
        </Campo>

        <Campo
          id="umbralEnvioGratisCop"
          etiqueta="Envío gratis desde"
          ayuda="Subtotal a partir del cual no se cobra envío. Para no ofrecer envío gratis, usa un valor muy alto."
        >
          <input
            id="umbralEnvioGratisCop"
            name="umbralEnvioGratisCop"
            inputMode="numeric"
            value={valores.umbralEnvioGratisCop}
            onChange={escribir("umbralEnvioGratisCop")}
            className={claseCampo}
          />
        </Campo>

        <Campo
          id="minutosReserva"
          etiqueta="Reserva de inventario (minutos)"
          ayuda="Cuánto tiempo se aparta el stock mientras alguien termina de pagar."
        >
          <input
            id="minutosReserva"
            name="minutosReserva"
            inputMode="numeric"
            value={valores.minutosReserva}
            onChange={escribir("minutosReserva")}
            className={claseCampo}
          />
        </Campo>
      </div>

      {/* Ejemplo en vivo: los números sueltos no dicen nada, un pedido sí. */}
      <div className="mt-6 rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)] p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--texto-suave)]">Un pedido de</span>
          <input
            aria-label="Subtotal del pedido de ejemplo"
            inputMode="numeric"
            value={ejemplo}
            onChange={(e) => setEjemplo(e.target.value)}
            className="cifra w-32 rounded-lg border bg-[var(--fondo-elevado)] px-3 py-1.5 text-sm outline-none focus:border-[var(--acento)]"
          />
          <span className="text-[var(--texto-suave)]">quedaría así:</span>
        </div>

        {config && subtotal !== null ? (
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--texto-suave)]">Productos</dt>
              <dd className="cifra">{formatearCOP(subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--texto-suave)]">Envío</dt>
              <dd className="cifra">
                {calcularEnvio(subtotal, config) === 0
                  ? "Gratis"
                  : formatearCOP(calcularEnvio(subtotal, config))}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-1.5 font-medium">
              <dt>Total</dt>
              <dd className="cifra">
                {formatearCOP(subtotal + calcularEnvio(subtotal, config))}
              </dd>
            </div>
            {faltaParaEnvioGratis(subtotal, config) !== null && (
              <p className="pt-1 text-xs text-[var(--texto-tenue)]">
                Le faltarían {formatearCOP(faltaParaEnvioGratis(subtotal, config)!)} para el envío
                gratis.
              </p>
            )}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-[var(--texto-tenue)]">
            Escribe cifras válidas para ver el ejemplo.
          </p>
        )}
      </div>

      {cambios.length > 0 && (
        <div className="mt-5 rounded-[var(--radius-tarjeta)] border border-[var(--aviso)]/40 bg-[var(--aviso)]/10 p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4 shrink-0 text-[var(--aviso)]" aria-hidden />
            Vas a cambiar {cambios.length} {cambios.length === 1 ? "cosa" : "cosas"}
          </p>

          <ul className="mt-3 space-y-1 text-sm">
            {cambios.map((c) => (
              <li key={c.campo} className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--texto-suave)]">{c.etiqueta}:</span>
                <span className="text-[var(--texto-tenue)] line-through">{c.antes}</span>
                <ArrowRight className="size-3.5 text-[var(--texto-tenue)]" aria-hidden />
                <span className="font-medium">{c.ahora}</span>
              </li>
            ))}
          </ul>

          {tocaElDinero && (
            <p className="mt-3 text-xs text-[var(--texto-suave)]">
              Aplica a los pedidos que se creen desde que guardes. Los pedidos ya hechos guardan
              su propio total y no se tocan.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <Aviso resultado={resultado} />
        <Boton texto="Guardar ajustes" cargando="Guardando…" />
      </div>
    </form>
  );
}

// ============================================================================
// B) Pasarelas
// ============================================================================

export type PistaSecreto = { pista: string; actualizado: string } | null;

export type PasarelaAdmin = {
  pasarela: string;
  nombre: string;
  habilitada: boolean;
  pruebas: boolean;
  llavePublica: string;
  llavePrivada: PistaSecreto;
  secretoEventos: PistaSecreto;
  secretoIntegridad: PistaSecreto;
};

function Casilla({
  nombre,
  etiqueta,
  ayuda,
  inicial,
}: {
  nombre: string;
  etiqueta: string;
  ayuda: string;
  inicial: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
      <input
        type="checkbox"
        name={nombre}
        defaultChecked={inicial}
        className="mt-0.5 size-4 accent-[var(--acento)]"
      />
      <span>
        <span className="block text-sm font-medium">{etiqueta}</span>
        <span className="block text-xs text-[var(--texto-tenue)]">{ayuda}</span>
      </span>
    </label>
  );
}

function CampoSecreto({
  nombre,
  etiqueta,
  guardado,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  guardado: PistaSecreto;
  ayuda: string;
}) {
  return (
    <Campo
      id={nombre}
      etiqueta={etiqueta}
      ayuda={
        guardado
          ? `Guardada el ${formatearFecha(guardado.actualizado)}. Escribe algo solo para reemplazarla.`
          : ayuda
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={nombre}
          name={nombre}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={guardado ? "Sin cambios" : "Sin configurar"}
          className={`${claseCampo} flex-1`}
        />
        {guardado && (
          <span className="precio inline-flex items-center gap-1.5 rounded-full bg-[var(--fondo-hondo)] px-3 py-1.5 text-xs text-[var(--texto-suave)]">
            <KeyRound className="size-3.5" aria-hidden />
            {guardado.pista}
          </span>
        )}
      </div>
    </Campo>
  );
}

export function FormularioPasarela({
  pasarela,
  hayLlaveMaestra,
}: {
  pasarela: PasarelaAdmin;
  hayLlaveMaestra: boolean;
}) {
  const [resultado, accion] = useActionState<ResultadoAccion | null, FormData>(
    guardarPasarela,
    null,
  );

  const etiquetas =
    ETIQUETAS_PASARELA[pasarela.pasarela as keyof typeof ETIQUETAS_PASARELA] ??
    ETIQUETAS_PASARELA.wompi;

  // Solo las pasarelas que el código sabe procesar tienen webhook que ofrecer.
  const urlWebhook = URL_WEBHOOK[pasarela.pasarela] ?? null;

  return (
    <form action={accion} className="bloque p-6 sm:p-7">
      <input type="hidden" name="pasarela" value={pasarela.pasarela} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-xl">{pasarela.nombre}</h2>
        <span className="text-xs text-[var(--texto-tenue)]">
          {pasarela.habilitada ? "Cobrando" : "Apagada"} ·{" "}
          {pasarela.pruebas ? "modo pruebas" : "producción"}
        </span>
      </div>

      {/*
        Las llaves privadas NO se devuelven al navegador, ni recortadas. Se
        enseña una pista con el prefijo y los últimos cuatro caracteres, que es
        lo único que sirve para reconocerlas, y el campo es de escritura: en
        blanco significa "déjala como está".
      */}
      <p className="mt-2 text-sm text-[var(--texto-suave)]">
        Los secretos se guardan cifrados y no se muestran nunca. Solo verás una pista para
        reconocerlos.
      </p>

      {!hayLlaveMaestra && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Falta PAYMENT_SECRETS_ENCRYPTION_KEY en el servidor: no se pueden guardar secretos
          nuevos hasta que esté.
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Casilla
          nombre="habilitada"
          etiqueta="Cobrar con esta pasarela"
          ayuda="Si se apaga, el checkout deja de ofrecerla."
          inicial={pasarela.habilitada}
        />
        <Casilla
          nombre="pruebas"
          etiqueta="Modo pruebas (sandbox)"
          ayuda="Con llaves de prueba no se mueve dinero real."
          inicial={pasarela.pruebas}
        />
      </div>

      {/*
        Los campos se rotulan SEGÚN LA PASARELA. En Wompi la "llave privada" es
        prv_…; en Mercado Pago ese mismo campo es el Access Token, y el secreto
        de integridad ni siquiera existe. Un campo mal rotulado hace que alguien
        pegue la llave equivocada, y eso son cobros que no entran.
      */}
      <div className="mt-5 grid gap-5">
        {etiquetas.llavePublica && (
          <Campo
            id="llavePublica"
            etiqueta={etiquetas.llavePublica.etiqueta}
            ayuda={etiquetas.llavePublica.ayuda}
          >
            <input
              id="llavePublica"
              name="llavePublica"
              defaultValue={pasarela.llavePublica}
              spellCheck={false}
              className={claseCampo}
            />
          </Campo>
        )}

        <CampoSecreto
          nombre="llavePrivada"
          etiqueta={etiquetas.llavePrivada.etiqueta}
          guardado={pasarela.llavePrivada}
          ayuda={etiquetas.llavePrivada.ayuda}
        />
        <CampoSecreto
          nombre="secretoEventos"
          etiqueta={etiquetas.secretoEventos.etiqueta}
          guardado={pasarela.secretoEventos}
          ayuda={etiquetas.secretoEventos.ayuda}
        />
        {etiquetas.secretoIntegridad && (
          <CampoSecreto
            nombre="secretoIntegridad"
            etiqueta={etiquetas.secretoIntegridad.etiqueta}
            guardado={pasarela.secretoIntegridad}
            ayuda={etiquetas.secretoIntegridad.ayuda}
          />
        )}
      </div>

      {urlWebhook && (
        <div className="mt-5 rounded-xl bg-[var(--fondo-hondo)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--texto-tenue)]">
            URL del webhook
          </p>
          <p className="mt-1.5 break-all font-mono text-sm text-[var(--texto)]">{urlWebhook}</p>
          <p className="mt-2 text-sm text-[var(--texto-suave)]">
            Pégala en el panel de la pasarela para que avise cuándo se pagó un pedido. Sin
            esto los pedidos se quedan pendientes aunque el cliente pague.
          </p>
        </div>
      )}

      {etiquetas.donde && (
        <p className="mt-4 text-sm text-[var(--texto-tenue)]">
          Dónde encontrarlas: {etiquetas.donde}
        </p>
      )}

      <div className="mt-5">
        <Casilla
          nombre="borrarSecretos"
          etiqueta="Borrar los secretos guardados"
          ayuda="Para desconectar la cuenta. Deja de poder cobrar hasta que se pongan otros."
          inicial={false}
        />
      </div>

      <div className="mt-6 space-y-4">
        <Aviso resultado={resultado} />
        <Boton texto="Guardar pasarela" cargando="Guardando…" />
      </div>
    </form>
  );
}
