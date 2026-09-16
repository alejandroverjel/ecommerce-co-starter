import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { SITIO } from "@/lib/sitio";

/**
 * Firma del total que se muestra en la página de gracias.
 *
 * EL PROBLEMA: el cliente terminaba el checkout sin ver nunca la cifra que se
 * grabó. El carrito guarda el precio del momento en que se agregó cada
 * producto, así que si el administrador sube un precio con la pestaña abierta,
 * el resumen dice una cosa y el pedido se graba con otra. Con contra entrega,
 * esa diferencia aparece cuando el mensajero ya está en la puerta.
 *
 * POR QUÉ NO SE CONSULTA LA BASE: los números de pedido son secuenciales
 * (ORD-001000, ORD-001001…). Una página pública que aceptara un número y
 * devolviera su total sería un contador de ventas para cualquiera, y con un
 * poco más de datos, una fuga de información de clientes.
 *
 * LA SOLUCIÓN: el servidor firma `pedido|total` con AUTH_SECRET y manda la
 * firma en la URL. La página verifica y pinta. Si alguien cambia el total en
 * la barra de direcciones, la firma no cuadra y no se muestra nada. No hay
 * consulta, no hay enumeración, y el cliente ve lo que de verdad va a pagar.
 */

function llave(): string {
  const secreto = process.env.AUTH_SECRET;
  if (!secreto) {
    throw new Error("Falta AUTH_SECRET: no se puede firmar el recibo.");
  }
  return secreto;
}

function calcular(numeroPedido: string, totalCop: number): string {
  return createHmac("sha256", llave())
    .update(`recibo:${numeroPedido}:${totalCop}`)
    .digest("base64url");
}

/** Firma para adjuntar a la URL de la página de gracias. */
export function firmarRecibo(numeroPedido: string, totalCop: number): string {
  return calcular(numeroPedido, totalCop);
}

/**
 * URL de la página de gracias con el total ya firmado.
 *
 * La usan las dos pasarelas para su URL de retorno. Sin el total firmado, quien
 * volvía de Mercado Pago o de Wompi veía el número de pedido pero no la cifra
 * —la página la oculta cuando la firma no cuadra—, y quedaba sin saber cuánto
 * acababa de pagar. Con contra entrega sí se mostraba, porque esa respuesta la
 * arma el propio checkout.
 */
export function urlGraciasFirmada(numeroPedido: string, totalCop: number): string {
  const params = new URLSearchParams({
    pedido: numeroPedido,
    total: String(totalCop),
    firma: firmarRecibo(numeroPedido, totalCop),
  });
  return `${SITIO.dominio}/finalizar-compra/gracias/?${params.toString()}`;
}

/**
 * Devuelve el total solo si la firma corresponde. `null` en cualquier otro
 * caso: firma ausente, alterada, o total que no es un entero de pesos.
 */
export function leerReciboFirmado(
  numeroPedido: string | null,
  total: string | null,
  firma: string | null,
): number | null {
  if (!numeroPedido || !total || !firma) return null;

  // Enteros de pesos, nada de decimales ni notación exótica.
  if (!/^\d{1,9}$/.test(total)) return null;
  const totalCop = Number(total);

  let esperada: string;
  try {
    esperada = calcular(numeroPedido, totalCop);
  } catch {
    // Sin AUTH_SECRET no se puede verificar: se calla en vez de mostrar una
    // cifra sin comprobar.
    return null;
  }

  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(firma, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return totalCop;
}
