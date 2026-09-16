import next from "eslint-config-next";

/**
 * Configuración de ESLint (formato plano, exigido desde ESLint 9).
 *
 * No existía ninguna: `pnpm lint` fallaba con "couldn't find an
 * eslint.config.js", así que el paso de lint del workflow habría roto el
 * pipeline en el primer push.
 *
 * `eslint-config-next` 16 ya exporta configuración plana nativa, así que se
 * importa directo. No sirve envolverla en FlatCompat —el traductor del formato
 * antiguo—: revienta con "Converting circular structure to JSON" al intentar
 * validar un config que no lo necesita.
 */
const configuracion = [
  {
    // Artefactos de compilación y dependencias: no son código nuestro.
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "drizzle/migrations/**",
      "next-env.d.ts",
    ],
  },
  ...next,
];

export default configuracion;
