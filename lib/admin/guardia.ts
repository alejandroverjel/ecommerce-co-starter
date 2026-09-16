import "server-only";

import { auth, rolReal } from "@/auth";

/**
 * Guardia de las acciones del panel.
 *
 * El layout de /admin ya comprueba el rol, PERO ESO NO PROTEGE LAS ACCIONES.
 * Una server action de Next es un endpoint POST: se puede invocar directamente
 * con su identificador, sin pasar nunca por la página que la contiene. Una
 * comprobación en el layout no interviene en esa ruta.
 *
 * Por eso cada acción vuelve a preguntar aquí, y aquí se relee el rol de la
 * BASE DE DATOS, no del token: el rol viaja dentro del JWT y a un
 * administrador degradado le seguiría diciendo "admin" durante siete días.
 */

export type Actor = {
  id: string;
  rol: "admin" | "staff";
};

/** Lo que devuelve una acción cuando algo va mal. */
export type ResultadoAccion =
  | { ok: true; mensaje?: string }
  | { ok: false; error: string };

/**
 * Exige sesión con rol de equipo o administración.
 *
 * Lanza en vez de devolver null: olvidarse de comprobar el retorno es
 * demasiado fácil, y el precio de ese olvido es dejar entrar a cualquiera.
 * Una excepción no se puede ignorar por accidente.
 */
export async function exigirPersonal(): Promise<Actor> {
  const sesion = await auth();
  if (!sesion?.user?.id) throw new ErrorAutorizacion();

  const rol = await rolReal(sesion.user.id);
  if (rol !== "admin" && rol !== "staff") throw new ErrorAutorizacion();

  return { id: sesion.user.id, rol };
}

/** Exige rol de administración. Roles y ajustes de la tienda no los toca el equipo. */
export async function exigirAdmin(): Promise<Actor> {
  const actor = await exigirPersonal();
  if (actor.rol !== "admin") throw new ErrorAutorizacion();
  return actor;
}

export class ErrorAutorizacion extends Error {
  constructor() {
    // Mensaje deliberadamente vago: no confirma si la sesión existe, si el rol
    // es insuficiente o si la ruta siquiera es correcta.
    super("No tienes permiso para hacer eso.");
    this.name = "ErrorAutorizacion";
  }
}

/**
 * Envuelve el cuerpo de una acción con el manejo de errores común.
 *
 * Evita que cada acción repita el try/catch, y sobre todo evita que un error
 * inesperado llegue al navegador con el mensaje crudo de Postgres, que suele
 * exponer nombres de tabla y de restricción.
 */
export async function ejecutar(
  etiqueta: string,
  cuerpo: () => Promise<ResultadoAccion>,
): Promise<ResultadoAccion> {
  try {
    return await cuerpo();
  } catch (e) {
    if (e instanceof ErrorAutorizacion) {
      return { ok: false, error: e.message };
    }

    // Drizzle envuelve TODO error de pg en un DrizzleQueryError cuyo `message`
    // es "Failed query: <la SQL completa>\nparams: <los parámetros>". El error
    // real de Postgres —con su `code`— queda en `.cause`.
    //
    // Hay que desenvolverlo por dos motivos, y el segundo importa más:
    //   1. Sin desenvolver, ningún mensaje RCA* de las funciones plpgsql llega
    //      nunca al usuario; siempre cae en el genérico.
    //   2. Devolver el `message` del wrapper le mandaría al navegador la
    //      sentencia SQL entera con sus parámetros.
    const crudo =
      typeof e === "object" && e !== null && "cause" in e && e.cause ? e.cause : e;

    const codigo =
      typeof crudo === "object" && crudo !== null && "code" in crudo
        ? String((crudo as { code: unknown }).code)
        : null;

    // Solo los errores que las funciones de la base levantan a propósito
    // llevan un mensaje escrito para leerse. El resto no se muestra.
    if (codigo?.startsWith("RCA")) {
      return {
        ok: false,
        error: crudo instanceof Error ? crudo.message : "Operación rechazada.",
      };
    }

    console.error(`admin/${etiqueta}:`, e);
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
}
