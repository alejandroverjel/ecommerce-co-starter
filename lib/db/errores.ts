/**
 * Desenvuelve el error de Postgres que Drizzle esconde.
 *
 * Drizzle 0.45 envuelve TODO error de `pg` en un `DrizzleQueryError` cuyo
 * `message` es "Failed query: <la SQL completa>\nparams: <los parámetros>". El
 * error real de Postgres —con su `code` y su mensaje escrito para leerse—
 * queda en `.cause`.
 *
 * Mirar `e.code` de frente falla siempre y, peor, devolver `e.message` al
 * cliente le manda la sentencia SQL entera con sus parámetros: en el checkout
 * eso es el nombre, el correo, el teléfono y la dirección del comprador. Este
 * helper existe para que nadie vuelva a cometer ese error en un sitio nuevo.
 */

export type ErrorPg = {
  /** SQLSTATE de Postgres, p.ej. "23505", o un RCA0x de las funciones. */
  code?: string;
  /** Nombre de la restricción violada, cuando aplica. */
  constraint?: string;
  /** Mensaje de Postgres. NO exponer al cliente salvo los RCA*, que sí están
   *  escritos para leerse. */
  message?: string;
};

/** Desenvuelve `.cause` (una sola vez) y extrae code/constraint/message. */
export function errorPg(e: unknown): ErrorPg | null {
  const crudo =
    typeof e === "object" && e !== null && "cause" in e && e.cause ? e.cause : e;

  if (typeof crudo !== "object" || crudo === null) return null;

  const o = crudo as { code?: unknown; constraint?: unknown; message?: unknown };
  return {
    code: o.code === undefined ? undefined : String(o.code),
    constraint: o.constraint === undefined ? undefined : String(o.constraint),
    message: typeof o.message === "string" ? o.message : undefined,
  };
}
