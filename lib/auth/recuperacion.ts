import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { users, verificationTokens } from "@/lib/db/schema";
import { VIGENCIA_MINUTOS } from "@/lib/auth/constantes";

/**
 * ============================================================================
 * Recuperación de contraseña
 * ============================================================================
 *
 * Usa `verification_tokens`, que estaba declarada en el schema y sin usar.
 *
 * EL TOKEN NO SE GUARDA. En la base va su SHA-256. Un `pg_dump` filtrado, o un
 * respaldo en un portátil, no debe entregar un juego de llaves para entrar a
 * cuentas ajenas: con solo el hash no se puede reconstruir el enlace.
 *
 * SHA-256 y no argon2, que es lo que se usa para las contraseñas: aquí la
 * entrada son 32 bytes aleatorios, no una palabra que alguien pueda adivinar.
 * No hay nada que ralentizar porque no hay diccionario que probar.
 *
 * `identifier` guarda el correo y `token` el hash — la llave primaria compuesta
 * de la tabla permite varios tokens vivos por persona (pidió el enlace dos
 * veces desde dos dispositivos), y todos se invalidan al usar cualquiera.
 */

function hashear(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Crea un token y devuelve el valor EN CLARO, que solo viaja en el correo.
 * Devuelve null si el correo no tiene cuenta: quien llama debe responder lo
 * mismo en los dos casos.
 */
export async function crearTokenRecuperacion(correo: string): Promise<string | null> {
  const filas = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, correo.toLowerCase()))
    .limit(1);

  if (filas.length === 0) return null;

  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + VIGENCIA_MINUTOS * 60_000);

  await db.insert(verificationTokens).values({
    identifier: correo.toLowerCase(),
    token: hashear(token),
    expires: expira,
  });

  return token;
}

/**
 * Cambia la contraseña si el token es válido, y quema TODOS los tokens de esa
 * cuenta en la misma transacción.
 *
 * Devuelve `ok:false` con el mismo mensaje para token inexistente, caducado o
 * ya usado: distinguirlos le diría a quien prueba enlaces al azar cuáles
 * existieron alguna vez.
 */
export async function usarTokenRecuperacion(
  correo: string,
  token: string,
  hashNuevo: string,
): Promise<{ ok: boolean }> {
  const identificador = correo.toLowerCase();
  const hashToken = hashear(token);

  return db.transaction(async (tx) => {
    // Se bloquea la fila para que dos envíos del mismo formulario no cambien
    // la contraseña dos veces.
    const { rows } = await tx.execute<{ token: string; expires: Date }>(sql`
      select token, expires
        from public.verification_tokens
       where identifier = ${identificador}
         and token = ${hashToken}
       limit 1
         for update
    `);

    const fila = rows[0];
    if (!fila) return { ok: false };

    if (new Date(fila.expires).getTime() < Date.now()) {
      // Caducado: se borra de paso, ya no sirve para nada.
      await tx
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, identificador),
            eq(verificationTokens.token, hashToken),
          ),
        );
      return { ok: false };
    }

    // Comparación de tiempo constante sobre el hash, por costumbre: aunque el
    // SELECT de arriba ya filtró por igualdad, esto no depende de cómo compare
    // Postgres ni de qué revele un índice.
    const a = Buffer.from(fila.token, "utf8");
    const b = Buffer.from(hashToken, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };

    await tx
      .update(users)
      .set({ passwordHash: hashNuevo })
      .where(eq(sql`lower(${users.email})`, identificador));

    // TODOS los tokens de esta cuenta, no solo el usado: si alguien pidió el
    // enlace tres veces, los otros dos no pueden seguir sirviendo.
    await tx
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, identificador));

    return { ok: true };
  });
}

/** Higiene: borra los tokens ya vencidos de cualquier cuenta. */
export async function limpiarTokensVencidos(): Promise<void> {
  await db.delete(verificationTokens).where(lt(verificationTokens.expires, new Date()));
}
