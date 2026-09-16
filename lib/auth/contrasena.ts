import "server-only";

import { hash, verify } from "@node-rs/argon2";

/**
 * Hash de contraseñas con argon2id.
 *
 * argon2id y no bcrypt: bcrypt trunca en 72 bytes —una frase larga en español
 * con tildes llega ahí antes de lo que parece— y resiste peor los ataques con
 * hardware dedicado.
 *
 * Parámetros: los recomendados por OWASP (19 MiB de memoria, 2 iteraciones,
 * 1 hilo). Subirlos encarece el ataque, pero también cada login legítimo, y en
 * un VPS de 4 vCPU compartido entre tres tiendas eso se nota.
 */

const OPCIONES = {
  algorithm: 2, // argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashearContrasena(plana: string): Promise<string> {
  return hash(plana, OPCIONES);
}

/**
 * Compara una contraseña con su hash.
 *
 * Devuelve `false` en vez de lanzar si el hash está corrupto o tiene un
 * formato viejo: un error aquí no debe distinguirse de una contraseña
 * equivocada, porque esa diferencia le dice a un atacante que la cuenta existe.
 */
export async function verificarContrasena(
  hashGuardado: string,
  plana: string,
): Promise<boolean> {
  try {
    return await verify(hashGuardado, plana, OPCIONES);
  } catch {
    return false;
  }
}

/**
 * Hash de descarte para cuentas sin contraseña.
 *
 * Se usa cuando el correo no existe: sin esto, el login responde al instante
 * para un correo desconocido y tarda ~50 ms para uno real, y esa diferencia
 * de tiempo basta para enumerar qué correos están registrados.
 */
const HASH_SENUELO =
  "$argon2id$v=19$m=19456,t=2,p=1$c2VudWVsby1ubyt1c2FyLWphbWFz$Ej6zvY3rGgHZ0k1QqLZ9xKQZ7VZ8oXqY5nJ4mR2wPbA";

export async function gastarTiempoComoSiExistiera(plana: string): Promise<void> {
  await verificarContrasena(HASH_SENUELO, plana);
}
