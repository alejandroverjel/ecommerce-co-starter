"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { cambiarRolUsuario } from "@/lib/admin/acciones-ajustes";
import type { ResultadoAccion } from "@/lib/admin/guardia";
import { ROLES } from "@/lib/validaciones/ajustes";
import { TEXTOS } from "@/components/admin/etiqueta-estado";

/**
 * Cambio de rol desde la tabla de clientes.
 *
 * El botón solo aparece cuando el desplegable deja de coincidir con lo que hay
 * guardado: así el cambio es siempre un acto deliberado y no un clic perdido
 * en una fila que no era.
 *
 * Aquí no vive ninguna regla de permisos. Todas —quién puede cambiar roles, el
 * no cambiarse el propio, no dejar la tienda sin administradores— se aplican en
 * el servidor. Esto solo evita ofrecer lo que se va a rechazar.
 */

function BotonGuardar() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--acento)] px-3 py-1.5 text-xs font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60"
    >
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

export function SelectorRol({
  usuarioId,
  rol,
  esYo,
  esUltimoAdmin,
}: {
  usuarioId: string;
  rol: string;
  /** Nadie se cambia el rol a sí mismo: lo exige el trigger de la base. */
  esYo: boolean;
  /** Quitarle el rol dejaría la tienda sin quien la administre. */
  esUltimoAdmin: boolean;
}) {
  const [resultado, accion] = useActionState<ResultadoAccion | null, FormData>(
    cambiarRolUsuario,
    null,
  );
  const [valor, setValor] = useState(rol);

  const bloqueado = esYo || esUltimoAdmin;
  const sucio = valor !== rol;

  return (
    <form action={accion} className="flex flex-col gap-1.5">
      <input type="hidden" name="usuarioId" value={usuarioId} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          name="rol"
          aria-label="Rol"
          value={valor}
          disabled={bloqueado}
          onChange={(e) => setValor(e.target.value)}
          className="rounded-full border bg-[var(--fondo-elevado)] px-3 py-1.5 text-xs outline-none transition-colors focus:border-[var(--acento)] disabled:opacity-60"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {TEXTOS[r]}
            </option>
          ))}
        </select>

        {sucio && !bloqueado && <BotonGuardar />}
      </div>

      {esYo && <p className="text-xs text-[var(--texto-tenue)]">Eres tú</p>}

      {esUltimoAdmin && !esYo && (
        <p className="text-xs text-[var(--texto-tenue)]">
          Único administrador: nombra otro antes de cambiarlo
        </p>
      )}

      {resultado && (
        <p
          role={resultado.ok ? "status" : "alert"}
          className={`text-xs ${
            resultado.ok ? "text-[var(--disponible)]" : "text-[var(--peligro)]"
          }`}
        >
          {resultado.ok ? (resultado.mensaje ?? "Guardado.") : resultado.error}
        </p>
      )}
    </form>
  );
}
