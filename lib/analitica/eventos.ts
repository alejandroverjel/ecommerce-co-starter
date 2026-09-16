"use client";

/**
 * Eventos de analítica.
 *
 * Se disparan por DOS vías, sin duplicar la medición de GA4:
 *   - gtag('event', …)  → GA4 directo (el Measurement ID del código).
 *   - dataLayer.push(…) → GTM, que los enruta a Meta Pixel o a las conversiones
 *     de Google Ads configuradas en su interfaz (GA4 NO se configura en GTM,
 *     para no contar dos veces).
 *
 * Si el visitante no aceptó cookies, ni gtag ni GTM están cargados: los llamados
 * son no-ops silenciosos, así que se pueden usar sin condicionales.
 *
 * El clic en WhatsApp NO se instrumenta aquí: GTM lo captura por la URL del
 * enlace (contiene "wa.me"), sin necesidad de tocar cada botón.
 */

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
    dataLayer?: Record<string, unknown>[];
  }
}

export type ItemAnalitica = {
  id: string;
  nombre: string;
  precioCop: number;
  cantidad: number;
};

/** Empuja un evento a las dos vías (GA4 directo + dataLayer para GTM). */
function emitir(evento: string, ecommerce: Record<string, unknown>): void {
  if (typeof window === "undefined") return;

  window.gtag?.("event", evento, ecommerce);

  window.dataLayer = window.dataLayer || [];
  // Limpiar el ecommerce previo antes de empujar, como recomienda GA4, para
  // no arrastrar datos de un evento anterior.
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({ event: evento, ecommerce });
}

function aItemsGA4(items: ItemAnalitica[]) {
  return items.map((i) => ({
    item_id: i.id,
    item_name: i.nombre,
    price: i.precioCop,
    quantity: i.cantidad,
  }));
}

/** Agregó un producto al carrito. */
export function trackearAgregarCarrito(item: ItemAnalitica): void {
  emitir("add_to_cart", {
    currency: "COP",
    value: item.precioCop * item.cantidad,
    items: aItemsGA4([item]),
  });
}

/** Empezó el checkout (envió el formulario de pedido). */
export function trackearIniciarCheckout(
  valorCop: number,
  items: ItemAnalitica[],
): void {
  emitir("begin_checkout", {
    currency: "COP",
    value: valorCop,
    items: aItemsGA4(items),
  });
}

/**
 * Compra completada. Se llama en la página de gracias con el total YA
 * verificado por firma (no un número de la URL que el cliente pueda inflar).
 * El id evita contar dos veces al recargar.
 */
export function trackearCompra(pedido: string, totalCop: number): void {
  emitir("purchase", {
    transaction_id: pedido,
    value: totalCop,
    currency: "COP",
  });
}
