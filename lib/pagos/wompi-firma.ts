import { createHash } from "node:crypto";

/**
 * ============================================================================
 * Wompi — funciones puras (firma y verificación)
 * ============================================================================
 *
 * Separadas de `lib/pagos/wompi.ts` porque estas SÍ las necesita el paquete de
 * checkout (`app/api/checkout/route.ts` y el webhook) sin arrastrar `db`,
 * `server-only` ni secretos de la tienda: solo `node:crypto` y tipos. `wompi.ts`
 * las reexporta para que las rutas de `app/api` no cambien de import.
 */

/** COP no tiene centavos, pero Wompi cobra en la subunidad: 1 COP = 100. */
export function aCentavos(cop: number): number {
  return Math.round(cop) * 100;
}

/**
 * Verifica la firma de un evento de webhook de Wompi.
 *
 * Wompi firma cada evento con SHA-256 sobre la concatenación de los valores de
 * las propiedades listadas en `signature.properties`, en orden, seguidas del
 * timestamp y del secreto de EVENTOS (distinto del de integridad). Si la firma
 * no cuadra, el POST no vino de Wompi y se descarta: sin esto, cualquiera que
 * conozca la URL del webhook podría dar pedidos por pagados.
 */
export function eventoWompiEsAutentico(
  cuerpo: {
    signature?: { checksum?: string; properties?: string[] };
    timestamp?: number | string;
    data?: unknown;
  },
  secretoEventos: string,
): boolean {
  const checksum = cuerpo.signature?.checksum;
  const propiedades = cuerpo.signature?.properties;
  const timestamp = cuerpo.timestamp;

  if (!checksum || !Array.isArray(propiedades) || timestamp === undefined) {
    return false;
  }

  const concatenado = propiedades
    .map((ruta) => valorPorRuta(cuerpo.data, ruta))
    .join("");

  const calculado = createHash("sha256")
    .update(`${concatenado}${timestamp}${secretoEventos}`)
    .digest("hex")
    .toUpperCase();

  const recibido = checksum.toUpperCase();

  // Comparación de longitud fija: ambos son hex de 64 caracteres.
  if (calculado.length !== recibido.length) return false;
  let diff = 0;
  for (let i = 0; i < calculado.length; i++) {
    diff |= calculado.charCodeAt(i) ^ recibido.charCodeAt(i);
  }
  return diff === 0;
}

/** Baja por una ruta con puntos, p.ej. "transaction.amount_in_cents". */
function valorPorRuta(raiz: unknown, ruta: string): string {
  let actual: unknown = raiz;
  for (const parte of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null) return "";
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual === undefined || actual === null ? "" : String(actual);
}
