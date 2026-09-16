"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";

import { entrar, type ResultadoAccion } from "@/lib/auth/acciones";

const claseCampo =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

function Boton() {
  // `useFormStatus` lee el estado del formulario padre, así que el botón sabe
  // que se está enviando sin que haya que pasarle nada.
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
          Entrando…
        </>
      ) : (
        "Entrar"
      )}
    </button>
  );
}

export function FormularioEntrar() {
  const [resultado, accion] = useActionState<ResultadoAccion, FormData>(
    entrar,
    undefined,
  );

  return (
    <div className="tarjeta p-7">
      <h1 className="display text-2xl">Entrar</h1>
      <p className="mt-1.5 text-sm text-[var(--texto-suave)]">
        Para ver tus pedidos y comprar más rápido.
      </p>

      {/* `action` en vez de `onSubmit`: funciona aunque el JavaScript no
          cargue, y la contraseña no pasa por el bundle del cliente. */}
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

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="contrasena" className="text-sm font-medium">
              Contraseña
            </label>
            <Link
              href="/recuperar/"
              className="text-xs text-[var(--texto-suave)] hover:text-[var(--acento)] hover:underline"
            >
              ¿La olvidaste?
            </Link>
          </div>
          <input
            id="contrasena"
            name="contrasena"
            type="password"
            autoComplete="current-password"
            required
            className={claseCampo}
          />
        </div>

        {resultado?.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {resultado.error}
          </p>
        )}

        <Boton />
      </form>

      <p className="mt-6 text-center text-sm text-[var(--texto-suave)]">
        ¿No tienes cuenta?{" "}
        <Link href="/crear-cuenta/" className="font-medium text-[var(--acento)] hover:underline">
          Créala aquí
        </Link>
      </p>
    </div>
  );
}
