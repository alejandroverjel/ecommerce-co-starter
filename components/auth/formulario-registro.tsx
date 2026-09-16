"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";

import { registrar, type ResultadoAccion } from "@/lib/auth/acciones";
import { MIN_CONTRASENA } from "@/lib/auth/constantes";

const claseCampo =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

function Boton() {
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
          Creando tu cuenta…
        </>
      ) : (
        "Crear cuenta"
      )}
    </button>
  );
}

export function FormularioRegistro() {
  const [resultado, accion] = useActionState<ResultadoAccion, FormData>(
    registrar,
    undefined,
  );

  return (
    <div className="tarjeta p-7">
      <h1 className="display text-2xl">Crear cuenta</h1>
      <p className="mt-1.5 text-sm text-[var(--texto-suave)]">
        Guarda tus datos y sigue tus pedidos.
      </p>

      <form action={accion} className="mt-6 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Tu nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            type="text"
            autoComplete="name"
            required
            className={claseCampo}
          />
        </div>

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
          <label htmlFor="contrasena" className="text-sm font-medium">
            Contraseña
          </label>
          {/* Se pide longitud, no mayúsculas ni símbolos: las reglas de
              composición empujan hacia "Password1!", que es peor que una
              frase larga. */}
          <p className="text-xs text-[var(--texto-tenue)]">
            Mínimo {MIN_CONTRASENA} caracteres. Una frase que recuerdes funciona bien.
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
            Repite la contraseña
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
        ¿Ya tienes cuenta?{" "}
        <Link href="/entrar/" className="font-medium text-[var(--acento)] hover:underline">
          Entra aquí
        </Link>
      </p>
    </div>
  );
}
