import { createHmac } from "node:crypto";

/**
 * ============================================================================
 * Mercado Pago — funciones puras (firma, verificación y armado de líneas)
 * ============================================================================
 *
 * Separadas de `lib/pagos/mercadopago.ts` porque estas SÍ las necesita el
 * paquete de checkout (`app/api/checkout/route.ts` y el webhook) sin arrastrar
 * `db`, `server-only` ni secretos de la tienda: solo `node:crypto` y tipos.
 * `mercadopago.ts` las reexporta para que las rutas de `app/api` no cambien de
 * import.
 */

export type LineaPreferencia = {
  titulo: string;
  cantidad: number;
  precioCop: number;
};

/**
 * Decide qué ítems mandar a Mercado Pago.
 *
 * EL COBRO TIENE QUE CUADRAR CON `orders.total_cop`, SIEMPRE. Mercado Pago
 * suma los ítems más el envío y cobra eso; no tiene un campo de descuento en
 * la preferencia. Con un cupón aplicado, mandar el desglose tal cual cobraría
 * de más —el descuento se perdería por el camino— y el cliente pagaría una
 * cifra distinta de la que aceptó en el carrito.
 *
 * Así que: si el desglose cuadra exactamente con el total, se manda (el
 * cliente ve su pedido detallado en MP, que es lo deseable). Si no cuadra —por
 * un cupón, por un redondeo o por cualquier motivo futuro— se colapsa en una
 * sola línea por el total. Se prefiere perder el detalle antes que cobrar mal.
 */
export function lineasParaPreferencia(
  items: LineaPreferencia[],
  envioCop: number,
  totalCop: number,
  referencia: string,
): { lineas: LineaPreferencia[]; envioCop: number } {
  const suma = items.reduce((acc, l) => acc + l.precioCop * l.cantidad, 0) + envioCop;

  if (items.length > 0 && suma === totalCop) {
    return { lineas: items, envioCop };
  }

  return {
    lineas: [{ titulo: `Pedido ${referencia}`, cantidad: 1, precioCop: totalCop }],
    envioCop: 0,
  };
}

/**
 * Verifica la firma del webhook.
 *
 * MP manda `x-signature: ts=<epoch>,v1=<hmac>` y `x-request-id`. El HMAC-SHA256
 * se calcula sobre un "manifest" con formato exacto —incluidos los puntos y
 * coma finales— usando la clave secreta del webhook:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Sin esta comprobación, cualquiera que conozca la URL podría dar por pagado
 * un pedido con un POST.
 */
export function firmaMercadoPagoEsValida(
  cabeceraFirma: string | null,
  idPeticion: string | null,
  idRecurso: string,
  secreto: string,
): boolean {
  if (!cabeceraFirma || !idRecurso) return false;

  const partes = new Map<string, string>();
  for (const trozo of cabeceraFirma.split(",")) {
    const [clave, valor] = trozo.split("=", 2);
    if (clave && valor) partes.set(clave.trim(), valor.trim());
  }

  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  if (!ts || !v1) return false;

  // Una firma válida capturada hace días no debe seguir sirviendo para
  // reinyectar el evento: se rechaza si el sello es muy viejo o viene del
  // futuro. Cinco minutos es lo que MP recomienda de tolerancia.
  const segundos = Number(ts);
  if (!Number.isFinite(segundos)) return false;
  const desfase = Math.abs(Date.now() / 1000 - segundos);
  if (desfase > 300) return false;

  // El id alfanumérico va en minúsculas en el manifest; el numérico no cambia.
  const manifest = `id:${idRecurso.toLowerCase()};request-id:${idPeticion ?? ""};ts:${ts};`;

  const calculado = createHmac("sha256", secreto).update(manifest).digest("hex");

  if (calculado.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < calculado.length; i++) {
    diff |= calculado.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

/** Estado de Mercado Pago -> payment_status de la base. */
export function aEstadoPago(
  estadoMp: string,
): "aprobado" | "rechazado" | "reembolsado" | "pendiente" | null {
  switch (estadoMp) {
    case "approved":
      return "aprobado";
    case "refunded":
    case "charged_back":
      return "reembolsado";
    case "rejected":
    case "cancelled":
      return "rechazado";
    case "pending":
    case "in_process":
    case "in_mediation":
    case "authorized":
      return "pendiente";
    default:
      return null;
  }
}
