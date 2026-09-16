/**
 * Cálculo de envío. Funciones puras, sin acceso a base de datos.
 *
 * Viven aparte de `lib/data/tienda.ts` porque ese módulo es `server-only` y
 * estas fórmulas las necesita también el carrito, que corre en el navegador.
 *
 * Los NÚMEROS no están aquí: llegan como `ConfigTienda` desde el servidor, que
 * los lee de `store_settings`. Codificarlos en el cliente es exactamente el
 * error del starter, donde la interfaz mostraba $12.000 de envío y el servidor
 * calculaba $0 porque la tabla estaba vacía.
 */

export type ConfigTienda = {
  envioPlanoCop: number;
  umbralEnvioGratisCop: number;
  ivaBps: number;
  minutosReserva: number;
};

/** Costo de envío para un subtotal dado. */
export function calcularEnvio(subtotalCop: number, config: ConfigTienda): number {
  if (subtotalCop <= 0) return 0;
  return subtotalCop >= config.umbralEnvioGratisCop ? 0 : config.envioPlanoCop;
}

/** Cuánto falta para el envío gratis. `null` si ya lo alcanzó. */
export function faltaParaEnvioGratis(
  subtotalCop: number,
  config: ConfigTienda,
): number | null {
  if (subtotalCop >= config.umbralEnvioGratisCop) return null;
  return config.umbralEnvioGratisCop - subtotalCop;
}
