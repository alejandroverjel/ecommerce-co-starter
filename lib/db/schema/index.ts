/**
 * Barril del schema. `drizzle-kit` apunta aca (drizzle.config.ts) y el cliente
 * de Drizzle lo importa completo con `import * as schema` para habilitar la
 * query API relacional (`db.query.products.findMany({ with: { variants: true } })`).
 *
 * Orden de los re-exports = orden de dependencias. No hay ciclos:
 *   enums -> auth -> catalog -> commerce -> relations
 *   settings solo depende de enums.
 */

export * from "./_shared";
export * from "./enums";
export * from "./auth";
export * from "./catalog";
export * from "./commerce";
export * from "./settings";
export * from "./campanas";
export * from "./relations";
