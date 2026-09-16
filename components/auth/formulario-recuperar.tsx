"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import {
  cambiarContrasena,
  pedirEnlace,
  type ResultadoRecuperar,
} from "@/lib/auth/recuperar";
import { MIN_CONTRASENA, VIGENCIA_MINUTOS } from "@/lib/auth/constantes";

const claseCampo =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

function Boton({ texto, cargando }: { texto: string; cargando: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60"
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

function Error({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {mensaje}
    </p>
  );
}

/** Paso 1: pedir el enlace. */
export function FormularioPedirEnlace() {
  const [resultado, accion] = useActionState<ResultadoRecuperar, FormData>(
    pedirEnlace,
    undefined,
  );

  /**
   * El acuse es el MISMO exista o no la cuenta. Decir "ese correo no está
   * registrado" convertiría esta pantalla —pública y sin contraseña— en un
   * comprobador de correos.
   */
  if (resultado?.listo) {
    return (
      <div className="tarjeta p-7 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--disponible)]/12">
          <CheckCircle2 className="size-6 text-[var(--disponible)]" aria-hidden />
        </div>
        <h1 className="display mt-5 text-2xl">Revisa tu correo</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--texto-suave)]">
          Si ese correo tiene una cuenta, le acaba de llegar un enlace para cambiar la
          contraseña. Sirve por {VIGENCIA_MINUTOS} minutos.
        </p>
        <Link
          href="/entrar/"
          className="mt-6 inline-block text-sm font-medium text-[var(--acento)] hover:underline"
        >
          Volver a entrar
        </Link>
      </div>
    );
  }

  return (
    <div className="tarjeta p-7">
      <h1 className="display text-2xl">¿Olvidaste tu contraseña?</h1>
      <p className="mt-1.5 text-sm text-[var(--texto-suave)]">
        Escribe tu correo y te mandamos un enlace para cambiarla.
      </p>

      <form action={accion} className="mt-6 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="correo" className="text-sm font-medium">
            Correo
          </label>
          <input
            id="correo"
            name="correo"
            type="email"
            autoComplete="email"
            required
            className={claseCampo}
          />
        </div>

        <Error mensaje={resultado?.error} />
        <Boton texto="Mandar el enlace" cargando="Mandando…" />
      </form>

      <p className="mt-6 text-center text-sm text-[var(--texto-suave)]">
        <Link href="/entrar/" className="font-medium text-[var(--acento)] hover:underline">
          Volver a entrar
        </Link>
      </p>
    </div>
  );
}

/** Paso 2: escribir la contraseña nueva. */
export function FormularioCambiar({ correo, token }: { correo: string; token: string }) {
  const [resultado, accion] = useActionState<ResultadoRecuperar, FormData>(
    cambiarContrasena,
    undefined,
  );

  return (
    <div className="tarjeta p-7">
      <h1 className="display text-2xl">Escribe tu contraseña nueva</h1>
      <p className="mt-1.5 text-sm text-[var(--texto-suave)]">
        Para <span className="font-medium text-[var(--texto)]">{correo}</span>.
      </p>

      <form action={accion} className="mt-6 space-y-4">
        {/* El correo y el token viajan ocultos: el servidor los revalida, así
            que editarlos aquí no abre ninguna puerta. */}
        <input type="hidden" name="correo" value={correo} />
        <input type="hidden" name="token" value={token} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="contrasena" className="text-sm font-medium">
            Contraseña nueva
          </label>
          <p className="text-xs text-[var(--texto-tenue)]">
            Al menos {MIN_CONTRASENA} caracteres. Una frase que recuerdes funciona mejor que
            algo corto con símbolos.
          </p>
          <input
            id="contrasena"
            name="contrasena"
            type="password"
            autoComplete="new-password"
            minLength={MIN_CONTRASENA}
            required
            className={claseCampo}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmacion" className="text-sm font-medium">
            Repítela
          </label>
          <input
            id="confirmacion"
            name="confirmacion"
            type="password"
            autoComplete="new-password"
            required
            className={claseCampo}
          />
        </div>

        <Error mensaje={resultado?.error} />
        <Boton texto="Cambiar la contraseña" cargando="Cambiando…" />
      </form>

      <p className="mt-6 text-center text-sm text-[var(--texto-suave)]">
        ¿El enlace ya venció?{" "}
        <Link href="/recuperar/" className="font-medium text-[var(--acento)] hover:underline">
          Pide uno nuevo
        </Link>
      </p>
    </div>
  );
}
