import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import {
  gastarTiempoComoSiExistiera,
  verificarContrasena,
} from "@/lib/auth/contrasena";
import { esquemaEntrar } from "@/lib/validaciones/cuenta";

/**
 * Autenticación — Auth.js v5 sobre el Postgres propio.
 *
 * El starter no tenía nada de esto: sus formularios de login y registro hacían
 * `preventDefault()` y ya. Aquí se construye completo.
 *
 * ESTRATEGIA DE SESIÓN: JWT, no base de datos.
 *
 * Auth.js no crea sesiones en base para el proveedor de credenciales; hacerlo
 * exige sobrescribir el codificador del token, que es frágil entre versiones.
 *
 * LIMITACIÓN CONOCIDA: con JWT no se puede cerrar la sesión de alguien desde
 * el servidor. Si se despide a un empleado, su token sigue siendo válido hasta
 * que expire (7 días). Se mitiga en parte con `rolReal()`, que relee el rol de
 * la base en las rutas sensibles: el token seguirá abierto, pero perderá los
 * permisos de administrador de inmediato. Cerrar sesiones de verdad exigiría
 * sesiones en base o una lista de revocación; queda pendiente y anotado.
 *
 * El adaptador de Drizzle se conserva para las tablas de usuarios y cuentas: si
 * más adelante se añade acceso con Google, ya está el cableado.
 */

/** Cuánto dura la sesión sin actividad. */
const DIAS_SESION = 7;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  session: {
    strategy: "jwt",
    maxAge: DIAS_SESION * 24 * 60 * 60,
  },

  pages: {
    signIn: "/entrar/",
    error: "/entrar/",
  },

  trustHost: true,

  providers: [
    Credentials({
      credentials: {
        correo: { label: "Correo", type: "email" },
        contrasena: { label: "Contraseña", type: "password" },
      },

      async authorize(credenciales) {
        const analisis = esquemaEntrar.safeParse(credenciales);
        if (!analisis.success) return null;

        const { correo, contrasena } = analisis.data;

        // `lower(email)` para que "Juan@example.com" y "juan@example.com" sean la misma
        // cuenta. El índice único del schema está sobre la misma expresión.
        const encontrados = await db
          .select({
            id: users.id,
            email: users.email,
            nombre: users.name,
            rol: users.role,
            hash: users.passwordHash,
          })
          .from(users)
          .where(eq(sql`lower(${users.email})`, correo))
          .limit(1);

        const usuario = encontrados[0];

        // Si el correo no existe, igual se gasta el tiempo de un hash. Sin
        // esto la respuesta es inmediata para correos desconocidos y tarda
        // ~50 ms para los reales, y esa diferencia permite enumerar cuentas.
        if (!usuario?.hash) {
          await gastarTiempoComoSiExistiera(contrasena);
          return null;
        }

        const correcta = await verificarContrasena(usuario.hash, contrasena);
        if (!correcta) return null;

        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.nombre,
          role: usuario.rol,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * EL ROL NO VIAJA EN EL TOKEN, A PROPÓSITO.
     *
     * Antes se copiaba aquí y se exponía en `session.user.role`. Nadie lo leía
     * —la autorización siempre pasa por `rolReal()`, que consulta la base—, y
     * mientras tanto era una trampa esperando: el primero que escribiera
     * `if (session.user.role === "admin")` habría creado un agujero silencioso,
     * porque el JWT dura siete días y no se puede revocar. A alguien que le
     * quitas el rol de administrador hoy, su token seguiría diciendo "admin"
     * hasta la semana que viene.
     *
     * Quitarlo hace imposible ese error: el dato ya no está para leerlo.
     */
    async jwt({ token, user }) {
      // Solo en el login: `user` viene poblado únicamente entonces.
      if (user) token.id = user.id;
      return token;
    },

    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
});

/**
 * Rol actual leído de la BASE DE DATOS, no del token.
 *
 * El rol viaja dentro del JWT, así que si a alguien se le quita el rol de
 * administrador su token sigue diciendo "admin" hasta que expire. Para
 * cualquier cosa sensible hay que preguntarle a la base.
 *
 * Usar en el panel de administración y en las rutas de API que escriben.
 * Para la vista de "mi cuenta" el token basta.
 */
export async function rolReal(idUsuario: string): Promise<string | null> {
  const filas = await db
    .select({ rol: users.role })
    .from(users)
    .where(eq(users.id, idUsuario))
    .limit(1);

  return filas[0]?.rol ?? null;
}

/** ¿La sesión actual pertenece a alguien que puede entrar al panel? */
export async function esPersonalAutorizado(): Promise<boolean> {
  const sesion = await auth();
  if (!sesion?.user?.id) return false;

  const rol = await rolReal(sesion.user.id);
  return rol === "admin" || rol === "staff";
}
