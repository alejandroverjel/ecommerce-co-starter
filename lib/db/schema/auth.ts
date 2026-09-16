import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "./_shared";
import { userRole } from "./enums";

/**
 * ============================================================================
 * users — tabla de Auth.js FUSIONADA con la vieja tabla `profiles`
 * ============================================================================
 *
 * En el starter original existian dos tablas: `auth.users` (propiedad de
 * Supabase, intocable) y `public.profiles` con un PK que la referenciaba. Esa
 * separacion NO tenia razon de negocio: existia solo porque no se podian
 * agregar columnas a una tabla de otro esquema. Aca somos duenos de Postgres,
 * asi que es una sola tabla y desaparece un JOIN de toda consulta autenticada.
 *
 * NOMBRE DE PROPIEDAD (TypeScript) vs NOMBRE DE COLUMNA (SQL):
 * el adaptador de Drizzle para Auth.js accede a las columnas por su nombre de
 * PROPIEDAD JS (`name`, `email`, `emailVerified`, `image`), no por el nombre
 * SQL. Aprovechamos eso para no duplicar columnas:
 *
 *   propiedad JS `name`  ->  columna SQL `full_name`   (era profiles.full_name)
 *   propiedad JS `image` ->  columna SQL `avatar_url`  (era profiles.avatar_url)
 *
 * Auth.js queda contento y el SQL conserva los nombres del schema original.
 *
 * El `id` es uuid y no text (el default del adaptador) para que todos los FK
 * del resto del schema sigan siendo uuid. Drizzle mapea uuid -> string en TS,
 * que es exactamente lo que `AdapterUser["id"]` espera.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- Campos que exige Auth.js -------------------------------------------
    name: text("full_name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", {
      withTimezone: true,
      mode: "date",
    }),
    image: text("avatar_url"),

    // --- Campos que venian de `profiles` ------------------------------------
    role: userRole("role").notNull().default("cliente"),
    phone: text("phone"),

    /**
     * argon2id. Null cuando el usuario solo entra por OAuth.
     * NUNCA seleccionar en queries cuyo resultado viaja al navegador: usar
     * siempre un `.select({ ... })` explicito en los route handlers.
     */
    passwordHash: text("password_hash"),

    ...timestamps,
  },
  (t) => [
    /**
     * Email unico CASE-INSENSITIVE: 'Juan@example.com' y 'juan@example.com' son la misma
     * cuenta. Un `unique()` normal dejaria crear las dos y el login por
     * Credentials se volveria ambiguo.
     */
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_role_idx").on(t.role),
  ],
);

/**
 * accounts — proveedores OAuth vinculados. Forma estandar del adaptador.
 * Los nombres de propiedad feos (`refresh_token`, `providerAccountId`) los fija
 * el adaptador de Auth.js; no se pueden "arreglar" sin romperlo.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type")
      .$type<"oauth" | "oidc" | "email" | "webauthn">()
      .notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

/**
 * sessions — sesiones persistidas en base de datos.
 *
 * Con el provider Credentials, Auth.js v5 obliga a estrategia JWT y esta tabla
 * queda sin uso; el adaptador la exige igual en su tipo. Se declara para poder
 * activar sesiones de DB (revocables desde el panel admin) sin otra migracion.
 */
export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** verificationTokens — magic links y verificacion de email. */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * ============================================================================
 * addresses — libreta de direcciones del cliente
 * ============================================================================
 *
 * Colombia: `departamento` + `ciudad`, no state/zip. No hay codigo postal util
 * para reparto local dentro de una ciudad, por eso la columna no existe.
 *
 * Esto es la libreta EDITABLE. Lo que se despacha vive congelado como snapshot
 * jsonb en orders.shipping_address.
 */
export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    label: text("label"),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),

    departamento: text("departamento").notNull(),
    ciudad: text("ciudad").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    notes: text("notes"),

    isDefault: boolean("is_default").notNull().default(false),

    ...timestamps,
  },
  (t) => [
    index("addresses_user_id_idx").on(t.userId),
    /**
     * Indice unico PARCIAL: como mucho una direccion predeterminada por
     * usuario, garantizado por la base y no por acordarse de limpiar la
     * anterior en el route handler.
     */
    uniqueIndex("addresses_one_default_per_user_uq")
      .on(t.userId)
      .where(sql`${t.isDefault}`),
  ],
);

// --- Tipos inferidos ---------------------------------------------------------

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;
export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;
export type VerificationToken = InferSelectModel<typeof verificationTokens>;
export type NewVerificationToken = InferInsertModel<typeof verificationTokens>;
export type Address = InferSelectModel<typeof addresses>;
export type NewAddress = InferInsertModel<typeof addresses>;
