/**
 * Lectura de importes escritos a mano.
 *
 * El panel lo usa gente escribiendo precios a las carreras. En Colombia el
 * separador de miles es el punto, así que "60.000" son sesenta mil pesos y no
 * sesenta con tres decimales. Interpretarlo mal cambia un producto de $60.000
 * a $60, o a $6.000.000.
 *
 * No vive en lib/formato.ts porque aquello es solo de salida; esto es entrada,
 * que es donde están los errores caros.
 */

export type LecturaImporte =
  | { ok: true; pesos: number }
  | { ok: false; error: string };

/**
 * Convierte lo que alguien escribe en un entero de pesos.
 *
 * Acepta: "60000", "60.000", "$ 60.000", "60 000", "$60.000 COP".
 * Rechaza: vacío, texto, negativos y decimales.
 *
 * Los decimales se rechazan en vez de redondearse a propósito. Si alguien
 * escribe "60.5" no se sabe si quiso 60 pesos con 50 centavos —que no existen
 * en este contexto— o si se equivocó tecleando; adivinar es peor que preguntar.
 */
export function leerImporte(entrada: string): LecturaImporte {
  const bruto = (entrada ?? "").trim();
  if (bruto === "") return { ok: false, error: "Escribe un precio" };

  // Fuera símbolo, espacios y el sufijo de moneda.
  const limpio = bruto
    .replace(/\s+/g, "")
    .replace(/\$/g, "")
    .replace(/cop$/i, "");

  if (!/^-?[\d.,]+$/.test(limpio)) {
    return { ok: false, error: "Solo números" };
  }

  if (limpio.startsWith("-")) {
    return { ok: false, error: "El precio no puede ser negativo" };
  }

  // Un punto o coma seguido de exactamente tres dígitos, y con más dígitos
  // delante, es separador de miles: "60.000", "1.450.000". Cualquier otro es
  // decimal, y aquí no se admiten.
  const sinMiles = limpio.replace(/(?<=\d)[.,](?=\d{3}(?:[.,]|$))/g, "");

  if (/[.,]/.test(sinMiles)) {
    return {
      ok: false,
      error: "Sin decimales: los precios van en pesos enteros",
    };
  }

  const n = Number(sinMiles);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: "No parece un precio" };
  }

  // integer de Postgres aguanta 2.147.483.647. Un tope muy por debajo atrapa
  // el dedazo de un cero de más antes de que llegue a la base.
  if (n > 50_000_000) {
    return { ok: false, error: "Demasiado alto, ¿sobra un cero?" };
  }

  return { ok: true, pesos: n };
}

/**
 * Lee una cantidad de unidades de inventario.
 *
 * Puede ser 0 —un producto agotado sigue publicado— pero nunca negativa.
 */
export function leerCantidad(entrada: string): LecturaImporte {
  const bruto = (entrada ?? "").trim();
  if (bruto === "") return { ok: false, error: "Escribe una cantidad" };

  if (!/^\d+$/.test(bruto)) {
    return { ok: false, error: "Solo números enteros, sin signo" };
  }

  const n = Number(bruto);
  if (n > 100_000) return { ok: false, error: "Demasiado alto, ¿sobra un cero?" };

  return { ok: true, pesos: n };
}

/** Porcentaje visible ↔ puntos básicos guardados. 19 % ↔ 1900. */
export const aPuntosBasicos = (porcentaje: number) => Math.round(porcentaje * 100);
export const aPorcentaje = (bps: number) => bps / 100;
