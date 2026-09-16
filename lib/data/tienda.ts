import "server-only";

import { unstable_cache } from "next/cache";

import { db } from "@/lib/db";
import { eq } from "drizzle-orm";

import { paymentGateways, storeSettings } from "@/lib/db/schema";
import type { ConfigTienda } from "@/lib/envio";

/**
 * Lee la configuración de la tienda: envío, IVA, tiempo de reserva.
 *
 * FUENTE ÚNICA. El starter tenía `FLAT_SHIPPING_COP = 12000` como constante en
 * el frontend mientras `create_pending_order` leía `store_settings` en el
 * servidor. Como la tabla estaba vacía, el servidor calculaba envío 0 y la
 * interfaz mostraba $12.000: el cliente veía un total y pagaba otro.
 *
 * Las fórmulas que usan estos números están en `lib/envio.ts`, que no es
 * server-only porque el carrito también las necesita en el navegador.
 *
 * VA EN CACHÉ: el layout raíz la llama en cada petición de cada página para
 * cuatro números que cambian una vez al año — era la consulta más repetida
 * de toda la tienda. La etiqueta `config-tienda` se invalida al instante
 * cuando el panel guarda ajustes (revalidateTag en guardarAjustesTienda),
 * así que el caché nunca miente; la hora de revalidación es solo la red de
 * seguridad por si alguien toca la tabla por fuera del panel.
 */
export const leerConfigTienda = unstable_cache(
  async (): Promise<ConfigTienda> => {
    const fila = await db
      .select({
        envioPlanoCop: storeSettings.flatShippingCop,
        umbralEnvioGratisCop: storeSettings.freeShippingThresholdCop,
        ivaBps: storeSettings.taxRateBps,
        minutosReserva: storeSettings.reservationTtlMinutes,
      })
      .from(storeSettings)
      .limit(1);

    // Si la fila no existe, FALLA. No devuelve valores por defecto a propósito:
    // un envío de $0 silencioso es el error que se está corrigiendo, y es peor
    // que una página caída porque nadie lo nota hasta cuadrar caja.
    if (fila.length === 0) {
      throw new Error(
        "store_settings está vacía. Corre `pnpm db:seed` antes de aceptar pedidos: " +
          "sin esa fila el envío se calcularía en 0.",
      );
    }

    return fila[0];
  },
  ["config-tienda"],
  { tags: ["config-tienda"], revalidate: 3600 },
);

/**
 * Pasarelas que de verdad pueden cobrar.
 *
 * El panel tiene un interruptor "Cobrar con esta pasarela" que escribe
 * `payment_gateways.is_enabled`. Antes esa columna no la leía NADIE: apagar
 * Wompi desde el panel no cambiaba nada y el checkout la seguía ofreciendo.
 * Un control que miente es peor que no tenerlo.
 *
 * No basta con `is_enabled`: hace falta que tenga con qué cobrar. Y QUÉ hace
 * falta depende de la pasarela:
 *
 *   - Wompi arma una URL firmada en el navegador → necesita la llave PÚBLICA.
 *   - Mercado Pago crea la preferencia por API desde el servidor → necesita el
 *     ACCESS TOKEN (guardado cifrado en config.secretos.llavePrivada), y no
 *     usa llave pública en absoluto.
 *
 * Exigir llave pública a las dos —como se hacía— dejaba Mercado Pago siempre
 * fuera del checkout aunque estuviera bien configurada. Ofrecer una pasarela
 * que no puede cobrar lleva al cliente a un error al final; ocultarla cuando sí
 * puede es una venta perdida en la última pantalla. Las dos cosas importan.
 */
export async function leerPasarelasHabilitadas(): Promise<string[]> {
  const filas = await db
    .select({
      pasarela: paymentGateways.gateway,
      llavePublica: paymentGateways.publicKey,
      config: paymentGateways.config,
    })
    .from(paymentGateways)
    .where(eq(paymentGateways.isEnabled, true));

  return filas
    .filter((f) => {
      // Se comprueba que el secreto EXISTE, sin descifrarlo: esto corre en cada
      // carga del checkout y no hay motivo para sacar la llave en claro solo
      // para saber si está puesta.
      const secretos = (f.config as { secretos?: Record<string, unknown> } | null)?.secretos;
      const hayToken = Boolean(secretos?.llavePrivada);

      switch (f.pasarela) {
        case "mercadopago":
          return hayToken;
        case "wompi":
          // No basta la llave pública: armar la URL firmada exige TAMBIÉN el
          // secreto de integridad (ver configuracionCobroWompi). Sin él,
          // ofrecer Wompi crea pedidos que nunca llegan a la pasarela y se
          // descubren al cuadrar caja. Se comprueba que existe, sin descifrarlo.
          return Boolean(f.llavePublica) && Boolean(secretos?.secretoIntegridad);
        default:
          // Una pasarela que nadie integró no se ofrece jamás, encendida o no.
          return false;
      }
    })
    .map((f) => f.pasarela);
}
