import { existsSync } from "node:fs";

import { defineConfig } from "vitest/config";

/**
 * Configuración de las pruebas.
 *
 * Dos suites con necesidades distintas:
 *
 *   pruebas/unidad/      — funciones puras. Rápidas, sin red ni base.
 *   pruebas/integracion/ — contra un Postgres de verdad. Aquí viven las
 *                          funciones plpgsql que sostienen el dinero, y
 *                          simularlas no probaría nada: el anti-sobreventa ES
 *                          el `SELECT ... FOR UPDATE`, no el código que lo
 *                          llama.
 *
 * Sin paralelismo entre archivos de integración: comparten la misma base y se
 * pisarían el inventario unos a otros.
 */
/**
 * Carga .env.local igual que hacen los scripts de package.json.
 *
 * Solo lo necesitan las pruebas de integración (DATABASE_URL): las de unidad
 * no importan nada que cargue `lib/db` y corren sin variables. En CI no hay
 * .env.local y las variables llegan del entorno del runner.
 */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  // Resuelve los alias de tsconfig (@/…) sin plugin: Vite ya lo hace nativo.
  resolve: { tsconfigPaths: true },
  test: {
    include: ["pruebas/**/*.test.ts"],
    // `server-only` aborta fuera del runtime de Next; se sustituye por un
    // módulo vacío para poder importar lo que lo usa.
    alias: { "server-only": new URL("./pruebas/vacio.ts", import.meta.url).pathname },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
