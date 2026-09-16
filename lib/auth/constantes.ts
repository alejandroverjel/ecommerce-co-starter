/**
 * Constantes de autenticación compartidas por cliente y servidor.
 *
 * SIN `server-only` y sin importar `@/lib/db`: `lib/validaciones/cuenta.ts` lo
 * importa y ese esquema corre también en el navegador (Client Component del
 * formulario de registro). `lib/auth/recuperacion.ts` sí es server-only —usa
 * Drizzle— así que su constante de vigencia vive aquí y no allá, para que
 * nada del lado cliente arrastre el bundle del servidor.
 */

/** Media hora: suficiente para ir al correo, corto para un enlace robado. */
export const VIGENCIA_MINUTOS = 30;

/**
 * Mínimo 10 caracteres, sin exigir mayúsculas ni símbolos.
 *
 * Las reglas de composición empujan a la gente hacia "Password1!", que es
 * peor que una frase larga. La longitud es lo que de verdad encarece un
 * ataque. Criterio del NIST SP 800-63B.
 */
export const MIN_CONTRASENA = 10;

/** El máximo evita el DoS por hash: argon2 sobre una entrada de un megabyte cuesta CPU real. */
export const MAX_CONTRASENA = 200;
