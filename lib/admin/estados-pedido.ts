import type { OrderStatus } from "@/lib/db/schema/enums";

/**
 * Máquina de estados del pedido.
 *
 * Vive fuera de `acciones-pedido.ts` porque un módulo "use server" solo puede
 * exportar funciones asíncronas, y estas tablas las necesitan los dos lados:
 * el servidor para RECHAZAR una transición inválida y el cliente para no
 * PINTAR el botón que la produciría. Una sola definición, dos usos.
 *
 * El import de `OrderStatus` es `import type`: se borra al compilar, así que
 * el schema de Drizzle (y con él `drizzle-orm/pg-core`) nunca entra al bundle
 * del navegador.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTAS TRANSICIONES Y NO OTRAS
 *
 * 1. `pendiente` solo avanza a `pagado`. No hay atajo a `en_preparacion`
 *    porque el CHECK `orders_paid_at_ck` exige `paid_at` en ese estado: un
 *    pedido no puede estar en preparación sin que conste el cobro. Esto
 *    incomoda al contra entrega, y esa incomodidad es deliberada — ver la nota
 *    al final.
 *
 * 2. Solo se cancela lo que nunca se cobró. Un pedido pagado no se "cancela":
 *    se REEMBOLSA, porque hay plata que devolver y esa plata tiene que quedar
 *    escrita. Dejar cancelar un pedido cobrado deja el dinero sin explicación
 *    en la contabilidad.
 *
 * 3. `cancelado` y `reembolsado` son terminales. De ahí no se sale desde el
 *    panel: reabrir un pedido cobrado y devuelto es justo el camino que en
 *    esta base ya provocó despachar mercancía de algo ya reembolsado (ver la
 *    cabecera de 0004_pagos.sql).
 *
 * 4. Hay tres retrocesos de UN paso, marcados como `correccion`. Existen
 *    porque el clic equivocado es real y la alternativa es entrar a psql, que
 *    es exactamente lo que este panel viene a eliminar. Son seguros: los tres
 *    se mueven dentro del grupo de estados que ya exigen `paid_at`, así que no
 *    tocan el CHECK, no tocan dinero y no tocan inventario. Solo corrigen la
 *    etiqueta.
 *
 * NOTA SOBRE EL CONTRA ENTREGA: el pedido se queda en `pendiente` hasta que
 * alguien cobra de verdad, y solo entonces se registra el cobro y avanza. Es
 * lo que el CHECK obliga y además es lo correcto: mientras no haya plata, no
 * hay pago. El costo operativo está anotado como pendiente en la vista de
 * entregas, que hoy no muestra los pedidos `pendiente`.
 * ---------------------------------------------------------------------------
 */

export type EstadoPedido = OrderStatus;

export type Transicion = {
  destino: EstadoPedido;
  /** Lo que dice el botón. Verbo, no sustantivo: "Marcar enviado". */
  etiqueta: string;
  /** Qué implica de verdad. Se muestra debajo del botón. */
  ayuda: string;
  /**
   * avance     — el camino normal del pedido.
   * correccion — deshacer un clic equivocado, un solo paso atrás.
   * peligro    — no tiene vuelta; se confirma en dos pasos.
   */
  tono: "avance" | "correccion" | "peligro";
  /**
   * Mueve dinero. Estas NO se resuelven con un UPDATE: pasan por
   * `fulfill_paid_order`, que es la única función que sabe escribir en
   * `payments`, descontar inventario una sola vez y dejar rastro en
   * `payment_events`.
   */
  dinero?: boolean;
};

export const TRANSICIONES = {
  pendiente: [
    {
      destino: "pagado",
      etiqueta: "Registrar pago",
      ayuda: "Para transferencias y efectivo cobrado a mano. Deja el cobro escrito.",
      tono: "avance",
      dinero: true,
    },
    {
      destino: "cancelado",
      etiqueta: "Cancelar pedido",
      ayuda: "Libera las unidades reservadas. No tiene vuelta.",
      tono: "peligro",
    },
  ],

  pagado: [
    {
      destino: "en_preparacion",
      etiqueta: "Poner en preparación",
      ayuda: "Alguien lo está armando.",
      tono: "avance",
    },
    {
      destino: "enviado",
      etiqueta: "Marcar enviado",
      ayuda: "Salió con el transportista.",
      tono: "avance",
    },
    {
      destino: "reembolsado",
      etiqueta: "Reembolsar",
      ayuda: "Deja el reembolso escrito en el cobro. No tiene vuelta.",
      tono: "peligro",
      dinero: true,
    },
  ],

  en_preparacion: [
    {
      destino: "enviado",
      etiqueta: "Marcar enviado",
      ayuda: "Salió con el transportista.",
      tono: "avance",
    },
    {
      destino: "pagado",
      etiqueta: "Volver a pagado",
      ayuda: "Todavía no se está armando.",
      tono: "correccion",
    },
    {
      destino: "reembolsado",
      etiqueta: "Reembolsar",
      ayuda: "Deja el reembolso escrito en el cobro. No tiene vuelta.",
      tono: "peligro",
      dinero: true,
    },
  ],

  enviado: [
    {
      destino: "entregado",
      etiqueta: "Marcar entregado",
      ayuda: "Llegó a manos del destinatario.",
      tono: "avance",
    },
    {
      destino: "en_preparacion",
      etiqueta: "Volver a preparación",
      ayuda: "Todavía no ha salido.",
      tono: "correccion",
    },
    {
      destino: "reembolsado",
      etiqueta: "Reembolsar",
      ayuda: "Deja el reembolso escrito en el cobro. No tiene vuelta.",
      tono: "peligro",
      dinero: true,
    },
  ],

  entregado: [
    {
      destino: "enviado",
      etiqueta: "Volver a en camino",
      ayuda: "Se marcó entregado por error.",
      tono: "correccion",
    },
    {
      destino: "reembolsado",
      etiqueta: "Reembolsar",
      ayuda: "Deja el reembolso escrito en el cobro. No tiene vuelta.",
      tono: "peligro",
      dinero: true,
    },
  ],

  cancelado: [],
  reembolsado: [],
} as const satisfies Record<EstadoPedido, readonly Transicion[]>;

/** Todos los valores del enum, en el orden en que avanza un pedido. */
export const ESTADOS_PEDIDO = [
  "pendiente",
  "pagado",
  "en_preparacion",
  "enviado",
  "entregado",
  "cancelado",
  "reembolsado",
] as const satisfies readonly EstadoPedido[];

export function transicionesDe(estado: string): readonly Transicion[] {
  return TRANSICIONES[estado as EstadoPedido] ?? [];
}

/**
 * La transición pedida, o null si no existe.
 *
 * El servidor la usa como AUTORIZACIÓN, no como conveniencia: que el botón no
 * se pinte no impide mandar el POST a mano.
 */
export function buscarTransicion(desde: string, hasta: string): Transicion | null {
  return transicionesDe(desde).find((t) => t.destino === hasta) ?? null;
}

/**
 * Medios de cobro que se registran a mano.
 *
 * No son `payment_method` del checkout —eso es lo que el cliente ELIGIÓ— sino
 * por dónde entró la plata de verdad.
 */
export const MEDIOS_COBRO = [
  { valor: "efectivo", etiqueta: "Efectivo (contra entrega)" },
  { valor: "transferencia", etiqueta: "Transferencia bancaria" },
  { valor: "nequi", etiqueta: "Nequi" },
  { valor: "daviplata", etiqueta: "Daviplata" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

export const VALORES_MEDIO = [
  "efectivo",
  "transferencia",
  "nequi",
  "daviplata",
  "otro",
] as const;

export function etiquetaMedio(valor: string): string {
  return MEDIOS_COBRO.find((m) => m.valor === valor)?.etiqueta ?? valor;
}
