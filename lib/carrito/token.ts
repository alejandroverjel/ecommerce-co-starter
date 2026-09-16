import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Enlaces firmados de los correos de carrito abandonado.
 *
 * Los dos enlaces del correo (recuperar el carrito y darse de baja) tienen que
 * funcionar SIN sesión: quien los abre viene del correo, no del sitio. Meter el
 * id de la fila a pelo dejaría que cualquiera recorriera carritos ajenos —con
 * su correo y lo que iba a comprar— o diera de baja a otra persona.
 *
 * Se firma `proposito:correo` con AUTH_SECRET, igual que lib/pagos/recibo.ts.
 * El propósito va DENTRO de la firma para que un enlace de baja no sirva como
 * enlace de recuperación ni al revés.
 *
 * Los enlaces no caducan a propósito: un correo de recuperación se abre a veces
 * días después, y el daño posible es nulo (recuperar un carrito propio o pedir
 * no recibir más correos). Lo que sí caduca es la ventana de envío, que la
 * controla el barrido.
 */

type Proposito = "recuperar" | "baja";

function llave(): string {
  const secreto = process.env.AUTH_SECRET;
  if (!secreto) {
    throw new Error("Falta AUTH_SECRET: no se pueden firmar los enlaces del correo.");
  }
  return secreto;
}

function calcular(proposito: Proposito, correo: string): string {
  return createHmac("sha256", llave())
    .update(`carrito:${proposito}:${correo.trim().toLowerCase()}`)
    .digest("base64url");
}

export function firmarEnlace(proposito: Proposito, correo: string): string {
  return calcular(proposito, correo);
}

/** `true` solo si la firma corresponde a ese propósito y ese correo. */
export function enlaceValido(
  proposito: Proposito,
  correo: string | null | undefined,
  firma: string | null | undefined,
): boolean {
  if (!correo || !firma) return false;

  let esperada: string;
  try {
    esperada = calcular(proposito, correo);
  } catch {
    return false;
  }

  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(firma, "utf8");
  // Comparación de tiempo constante: evita deducir la firma midiendo respuestas.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
