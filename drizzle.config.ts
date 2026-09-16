import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

/**
 * Carga .env.local en desarrollo.
 *
 * `next dev` y `next build` leen .env.local solos, pero drizzle-kit no: es un
 * binario aparte y arrancaba con DATABASE_URL sin definir, fallando con
 * "Please provide required params for Postgres driver: url: undefined". Habia
 * que exportar el entorno a mano antes de cada comando, cosa que no esta
 * escrita en ningun sitio y que muerde a quien clona el repo.
 *
 * `loadEnvFile` NO pisa lo que ya venga del entorno, asi que en el VPS —donde
 * las variables las inyecta el contenedor y no hay .env.local— manda el
 * contenedor. Los scripts de package.json hacen lo mismo con el flag
 * --env-file-if-exists de Node.
 */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * Configuracion de drizzle-kit.
 *
 * Flujo (nunca editar el schema en produccion a mano):
 *   pnpm drizzle-kit generate   -> escribe el SQL en ./drizzle/migrations
 *   pnpm drizzle-kit migrate    -> lo aplica en el orden del diario
 *   pnpm drizzle-kit check      -> detecta colisiones de migraciones entre ramas
 *
 * `push` queda prohibido fuera de local: se salta el historial de migraciones y
 * en un contenedor de produccion no hay forma de reproducir lo que paso.
 */
export default defineConfig({
  dialect: "postgresql",

  /**
   * Glob y no un archivo suelto: el schema esta partido por dominio en
   * lib/db/schema/. `index.ts` re-exporta todo, pero drizzle-kit necesita ver
   * los archivos individuales para no perderse enums ni secuencias.
   */
  schema: "./lib/db/schema/*.ts",
  /**
   * ESTRUCTURA DE MIGRACIONES — una sola carpeta, un solo diario.
   *
   * Antes esto decia "./drizzle" mientras las migraciones escritas a mano
   * (0001_funciones, 0002_seed) vivian en "./drizzle/migrations". Con esa
   * configuracion `generate` escribia ./drizzle/0000_*.sql + ./drizzle/meta/ y
   * `migrate` leia SOLO ./drizzle: las funciones y el seed no se aplicaban
   * nunca y la tienda arrancaba con las tablas vacias de logica.
   *
   * Ahora TODO vive en ./drizzle/migrations, con un unico meta/_journal.json:
   *   0000_schema.sql     generado por drizzle-kit desde lib/db/schema/*.ts
   *   0001_funciones.sql  custom (drizzle-kit generate --custom --name=funciones)
   *   0002_seed.sql       custom (drizzle-kit generate --custom --name=seed)
   * El diario fija el orden, asi que el 0000 SIEMPRE se aplica antes que las
   * funciones, y las funciones antes que el seed.
   *
   * Para agregar una migracion escrita a mano NO se crea el archivo a mano:
   *   pnpm drizzle-kit generate --custom --name=<nombre>
   * y se pega el SQL dentro. Un .sql que no este en _journal.json es invisible
   * para `migrate`.
   */
  out: "./drizzle/migrations",

  dbCredentials: {
    url: process.env.DATABASE_URL!,
    /** Red Docker interna: el trafico no sale del VPS. */
    ssl: false,
  },

  /**
   * Los nombres de columna estan escritos a mano en snake_case en el schema.
   * NO se activa `casing: "snake_case"` a proposito: con la conversion
   * automatica, renombrar una propiedad de TypeScript renombraria la columna
   * SQL y drizzle-kit generaria un DROP/ADD que borra datos. Explicito es mas
   * verboso y mucho menos peligroso.
   */

  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },

  /**
   * RLS DESCARTADO. `entities.roles: false` le dice a drizzle-kit que no
   * gestione roles de Postgres ni intente generar policies. La autorizacion
   * vive en los route handlers de Next.js; el navegador nunca abre una
   * conexion a Postgres.
   */
  entities: {
    roles: false,
  },

  verbose: true,
  /**
   * `strict: true` pide confirmacion antes de aplicar. Con productos reales
   * en catalogo, un DROP COLUMN silencioso no es recuperable sin restaurar
   * backup.
   */
  strict: true,
  breakpoints: true,
});
