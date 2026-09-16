import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Marcadores de borrador que NO pueden llegar a producción.
 *
 * Un placeholder como «[PENDIENTE: razón social y NIT]» en una página legal
 * se lee bien de lejos y solo salta si alguien se fija línea por línea: es
 * fácil que quede publicado meses sin que nadie lo note.
 *
 * Es el tipo de error que no se repite dos veces si hay un test, y que se
 * repite siempre si no lo hay.
 */
const PROHIBIDOS = ["[PENDIENTE", "TODO:", "FIXME", "Lorem ipsum", "XXX_"];

/** Recorre app/ y devuelve todos los .tsx y .ts. */
function fuentes(dir: string): string[] {
  const salida: string[] = [];

  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...fuentes(ruta));
    } else if (ruta.endsWith(".tsx") || ruta.endsWith(".ts")) {
      salida.push(ruta);
    }
  }

  return salida;
}

/**
 * Quita comentarios de bloque y de línea.
 *
 * Se busca solo en lo que el visitante puede llegar a leer. Un `TODO:` en un
 * comentario es trabajo pendiente normal y no tiene por qué fallar el build;
 * lo grave es el mismo texto dentro de un `<p>`.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("contenido publicado", () => {
  const archivos = fuentes("app");

  it("encuentra las páginas que debe vigilar", () => {
    expect(archivos.length).toBeGreaterThan(20);
  });

  for (const marcador of PROHIBIDOS) {
    it(`no publica «${marcador}» en ninguna página`, () => {
      const culpables = archivos.filter((ruta) =>
        sinComentarios(readFileSync(ruta, "utf8")).includes(marcador),
      );

      expect(
        culpables,
        `Estos archivos publican «${marcador}» donde el cliente lo ve:\n` +
          culpables.map((c) => `  · ${c}`).join("\n"),
      ).toEqual([]);
    });
  }
});
