import type { DefaultSession } from "next-auth";

/**
 * Extiende los tipos de Auth.js con lo propio de esta tienda.
 *
 * La sesión lleva el `id` y NADA MÁS. En concreto, NO lleva el rol.
 *
 * El rol vivía aquí y se exponía en `session.user.role`, pero la autorización
 * de verdad siempre la resuelve `rolReal()` leyendo la base: el JWT dura siete
 * días y no se puede revocar, así que a quien se le quita el permiso hoy su
 * token seguiría diciendo "admin" hasta que expire.
 *
 * Al no declararlo, TypeScript rechaza `session.user.role` y el error se ve al
 * escribirlo, no en producción.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
