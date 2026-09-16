import { z } from "zod";

import { TIENDA } from "@/tienda.config";

/**
 * Validación del checkout.
 *
 * El mismo esquema corre en el navegador y en el servidor. El servidor NUNCA
 * confía en los precios que manda el cliente: solo acepta qué y cuánto, y
 * vuelve a leer cada precio de la base.
 *
 * Casi todo lo que antes era texto fijo de un negocio ahora sale de
 * `tienda.config.ts`: cobertura, franjas de entrega, tope de mensaje de
 * regalo, unidades máximas por producto y si se pide destinatario aparte.
 */

/** Zona de cobertura: los municipios que declara tienda.config.ts. */
export const MUNICIPIOS = TIENDA.cobertura.municipios;

/** Etiquetas de las franjas configuradas, para el formulario. */
export const FRANJAS = TIENDA.entregas.franjas.map(({ valor, etiqueta }) => ({
  valor,
  etiqueta,
}));

type ValorFranja = (typeof TIENDA.entregas.franjas)[number]["valor"];

/**
 * Las franjas realmente ofrecidas por esta tienda (1 a 3), como tupla no
 * vacía para que z.enum la acepte. Es la que usa el checkout.
 */
export const VALORES_FRANJA = TIENDA.entregas.franjas.map((f) => f.valor) as [
  ValorFranja,
  ...ValorFranja[],
];

/**
 * Espejo del CHECK `orders_delivery_slot_ck` de la base: admite las tres
 * franjas exista o no la tienda ofreciéndolas hoy. Sirve para validar
 * ediciones del admin sobre pedidos antiguos, que pueden llevar una franja
 * que la tienda ya no ofrece.
 */
export const VALORES_FRANJA_DB = ["manana", "tarde", "noche"] as const;

/**
 * Métodos de pago.
 *
 * Solo se listan los que sí procesan. Wompi cubre tarjeta, PSE y Nequi
 * dentro de su checkout hospedado: no son métodos separados en nuestro lado.
 */
export const METODOS_PAGO = [
  { valor: "mercadopago", nombre: "Mercado Pago", etiqueta: "Tarjeta, PSE y más", ayuda: "Pago seguro con Mercado Pago" },
  { valor: "wompi", nombre: "Wompi", etiqueta: "Tarjeta, PSE y más", ayuda: "Pago seguro con Wompi" },
] as const;

/**
 * CONTRA ENTREGA RETIRADA.
 *
 * Un pedido sin cobrar reserva inventario y obliga a perseguir la plata en
 * la puerta. Ya no se ofrece ni se acepta en el checkout.
 *
 * El valor SIGUE existiendo en el enum de la base y en `ETIQUETAS_METODO`
 * porque los pedidos antiguos lo llevan guardado: quitarlo de ahí dejaría el
 * historial mostrando el valor crudo en el panel.
 */
export const VALORES_METODO = ["mercadopago", "wompi"] as const;

/** Incluye los métodos retirados, para no romper la lectura del historial. */
const ETIQUETAS_METODO: Record<string, string> = {
  mercadopago: "Tarjeta, PSE o efectivo",
  wompi: "Tarjeta, PSE o Nequi",
  "contra-entrega": "Contra entrega",
};

/** Tope de caracteres del mensaje de regalo. */
export const MAX_MENSAJE = TIENDA.checkout.maxMensaje;

/** Teléfono colombiano: 10 dígitos que empiezan por 3, o fijo de 7 u 8. */
const telefono = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^(\+?57)?(3\d{9}|[1-8]\d{6,7})$/,
        "Escribe un número colombiano válido, por ejemplo 3001234567",
      ),
  );

/** Zona horaria de la tienda. Todas las horas del checkout se leen en ella. */
const ZONA = TIENDA.ubicacion.zonaHoraria;

/** Hoy en la zona de la tienda, no en la del servidor ni la del navegador. */
export function hoyEnBogota(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
  }).format(new Date());
}

/** Alias explícito: mismo cálculo que hoyEnBogota, nombre neutro. */
export const hoyEnZona = hoyEnBogota;

/** Hora actual en la zona de la tienda, en minutos desde medianoche. */
export function minutosAhoraEnBogota(): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const minuto = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
  return hora * 60 + minuto;
}

/**
 * A qué hora deja de tener sentido aceptar cada franja del MISMO día.
 *
 * No es la hora de fin de la franja sino el corte para pedirla: hace falta
 * margen para armar el pedido y llegar. Viene de tienda.config.ts.
 */
export const CORTE_FRANJA: Record<string, number> = Object.fromEntries(
  TIENDA.entregas.franjas.map((f) => [f.valor, f.corteMin]),
);

function minutosAFormato(minutos: number): string {
  const h = Math.floor(minutos / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutos % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * La hora de corte más tardía entre las franjas configuradas: la última hora
 * a la que todavía se acepta un pedido para hoy. Única fuente para las
 * preguntas frecuentes, las páginas legales y el `cutoffTime` de los datos
 * estructurados.
 */
export const HORA_CORTE: string = minutosAFormato(
  Math.max(...TIENDA.entregas.franjas.map((f) => f.corteMin)),
);

/** ¿Se puede todavía pedir esta franja para hoy? */
export function franjaSigueAbierta(franja: string, fecha: string): boolean {
  if (fecha !== hoyEnZona()) return true; // otro día: no hay hora que cruzar
  const corte = CORTE_FRANJA[franja];
  if (corte === undefined) return false; // franja que esta tienda no ofrece
  return minutosAhoraEnBogota() < corte;
}

/**
 * El primer día que todavía admite alguna franja.
 *
 * Sirve para el valor inicial del formulario. Arrancar siempre en HOY dejaba
 * un callejón sin salida después de la última hora de corte: las franjas
 * aparecían cerradas y no había nada que escoger. Desde esa hora el
 * formulario abre en mañana.
 */
export function primeraFechaConFranja(): string {
  const minima = fechaMinimaEntrega();
  const hoy = hoyEnZona();

  // La anticipación mínima ya corrió la fecha a un día futuro: ese día no
  // tiene hora de corte que cruzar (franjaSigueAbierta siempre da true para
  // fechas futuras), así que es la respuesta.
  if (minima > hoy) return minima;

  if (VALORES_FRANJA.some((f) => franjaSigueAbierta(f, minima))) {
    return minima;
  }

  // Mañana en la zona de la tienda, saltando a un día que la tienda sí
  // entregue (TIENDA.entregas.diasEntrega): se avanza sobre la fecha civil,
  // no sobre el reloj del servidor, que puede estar en otra zona.
  return siguienteDiaDeEntrega(diaSiguiente(minima));
}

/** La primera franja abierta de una fecha, si queda alguna. */
export function primeraFranjaAbierta(fecha: string): ValorFranja | null {
  return VALORES_FRANJA.find((f) => franjaSigueAbierta(f, fecha)) ?? null;
}

/** Hasta dónde se puede programar una entrega. */
export function fechaMaxima(): string {
  const d = new Date();
  d.setDate(d.getDate() + TIENDA.entregas.diasMaximos);
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(d);
}

// Días de la semana en el mismo formato (inglés) que declara
// tienda.config.ts. Se compara como string ancho, no con el tipo literal
// de TIENDA.entregas.diasEntrega, para no atarse a qué días trae hoy la
// configuración de fábrica.
const NOMBRES_DIA: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DIAS_ENTREGA: readonly string[] = TIENDA.entregas.diasEntrega;

/**
 * Día de la semana (en inglés, como los declara tienda.config.ts) de una
 * fecha "YYYY-MM-DD". Se calcula sobre el calendario civil (UTC), no sobre
 * la zona del servidor: una fecha sin hora es el mismo día en cualquier
 * huso horario.
 */
function diaSemanaDe(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return NOMBRES_DIA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

/** ¿La tienda entrega ese día de la semana (TIENDA.entregas.diasEntrega)? */
export function esDiaDeEntrega(fecha: string): boolean {
  return DIAS_ENTREGA.includes(diaSemanaDe(fecha));
}

/** Un día calendario después de la fecha dada, en formato "YYYY-MM-DD". */
function diaSiguiente(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(
    new Date(Date.UTC(a, m - 1, d + 1)),
  );
}

/** El primer día, desde `desde` (inclusive), en que la tienda entrega. */
function siguienteDiaDeEntrega(desde: string): string {
  let fecha = desde;
  // TIENDA.entregas.diasEntrega nunca está vacío, así que esto termina en
  // 7 vueltas o menos.
  for (let i = 0; i < 7 && !esDiaDeEntrega(fecha); i++) fecha = diaSiguiente(fecha);
  return fecha;
}

/**
 * Anticipación mínima, en días, entre que se hace el pedido y la fecha de
 * entrega más temprana que el checkout puede ofrecer: el mínimo de
 * preparación más el mínimo de tránsito que declara tienda.config.ts. En 0
 * (el caso "mismo día"), no descarta hoy; mayor que 0 corre la fecha mínima
 * hacia adelante esa cantidad de días.
 */
export const ANTICIPACION_MINIMA_DIAS =
  TIENDA.entregas.tiempoPreparacionDias[0] + TIENDA.entregas.tiempoTransitoDias[0];

/**
 * La fecha más temprana que el checkout puede ofrecer: hoy más
 * ANTICIPACION_MINIMA_DIAS, saltando al primer día que la tienda entregue.
 *
 * Antes el checkout solo exigía `fechaEntrega >= hoy`, sin mirar
 * tiempoPreparacionDias ni tiempoTransitoDias: con la configuración de
 * fábrica ([0,1] y [1,3], es decir al menos un día de tránsito) se podía
 * pagar una entrega para hoy mientras el JSON-LD y el correo de "enviado"
 * ya declaraban 1 a 3 días de tránsito.
 */
function fechaMinimaEntrega(): string {
  let fecha = hoyEnZona();
  for (let i = 0; i < ANTICIPACION_MINIMA_DIAS; i++) fecha = diaSiguiente(fecha);
  return siguienteDiaDeEntrega(fecha);
}

const destinatarioNombreBase = z
  .string()
  .trim()
  .min(3, "Escribe el nombre de quien recibe")
  .max(120, "Demasiado largo");

export const esquemaPedido = z.object({
  // --- Quien compra ---------------------------------------------------------
  compradorNombre: z
    .string()
    .trim()
    .min(3, "Escribe tu nombre completo")
    .max(120, "Demasiado largo"),
  compradorCorreo: z
    .string()
    .trim()
    .toLowerCase()
    .email("Revisa el correo, parece incompleto"),
  compradorTelefono: telefono,

  // --- Quien recibe ---------------------------------------------------------
  // Si la tienda no pide destinatario aparte (checkout.destinatarioDistinto
  // en false), el destinatario es el comprador y estos campos son opcionales.
  destinatarioNombre: TIENDA.checkout.destinatarioDistinto
    ? destinatarioNombreBase
    : destinatarioNombreBase.optional(),
  destinatarioTelefono: TIENDA.checkout.destinatarioDistinto
    ? telefono
    : telefono.optional(),

  // --- Dónde ----------------------------------------------------------------
  municipio: z.enum(MUNICIPIOS, {
    message: "Escoge un municipio de la lista",
  }),
  direccion: z
    .string()
    .trim()
    .min(8, "Escribe la dirección completa, con barrio si aplica")
    .max(240, "Demasiado largo"),
  indicaciones: z.string().trim().max(400, "Demasiado largo").optional(),

  // --- Cuándo ---------------------------------------------------------------
  fechaEntrega: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Escoge una fecha")
    .refine(
      (v) => v >= fechaMinimaEntrega(),
      ANTICIPACION_MINIMA_DIAS > 0
        ? `Necesitamos al menos ${ANTICIPACION_MINIMA_DIAS} día${ANTICIPACION_MINIMA_DIAS === 1 ? "" : "s"} de anticipación`
        : "La fecha ya pasó",
    )
    .refine(
      (v) => v <= fechaMaxima(),
      `Muy lejos: máximo ${TIENDA.entregas.diasMaximos} días`,
    )
    .refine(esDiaDeEntrega, "Ese día no hacemos entregas. Escoge otra fecha."),
  franja: z.enum(VALORES_FRANJA, { message: "Escoge una franja" }),

  // --- El mensaje de regalo ---------------------------------------------------------
  /**
   * Opcional a propósito: obligar a escribir algo produce mensajes con ".".
   * El límite es el que declara tienda.config.ts. Si la tienda no ofrece
   * mensaje de regalo (checkout.mensajeRegalo en false), el campo se ignora.
   */
  mensajeTarjeta: z
    .string()
    .trim()
    .max(MAX_MENSAJE, `El mensaje no cabe en la tarjeta: máximo ${MAX_MENSAJE} caracteres`)
    .optional(),

  // --- Pago -----------------------------------------------------------------
  metodoPago: z.enum(VALORES_METODO, { message: "Escoge cómo quieres pagar" }),

  cupon: z.string().trim().max(40).optional(),
})
  /**
   * La franja y la fecha se validaban por separado, así que cerca del corte
   * se podía pedir entrega HOY en una franja ya cerrada: el pedido entraba
   * como entrega de hoy y aparecía en la pantalla de entregas del día ya
   * vencido. Cruzarlas es la única forma de detectarlo.
   */
  .refine((d) => franjaSigueAbierta(d.franja, d.fechaEntrega), {
    path: ["franja"],
    message: "Esa franja de hoy ya cerró. Escoge una más tarde o entrega para mañana.",
  });

export type DatosPedido = z.infer<typeof esquemaPedido>;

/**
 * Lo que viaja al servidor.
 *
 * Del carrito solo van producto y cantidad. Los precios NO se mandan: el
 * servidor los vuelve a leer de la base. Un cliente que edite localStorage no
 * puede comprar barato.
 */
export const esquemaPeticionPedido = esquemaPedido.extend({
  lineas: z
    .array(
      z.object({
        productoId: z.string().uuid("Producto inválido"),
        varianteId: z.string().uuid().nullable().optional(),
        cantidad: z
          .number()
          .int()
          .positive()
          .max(
            TIENDA.checkout.maxUnidadesPorProducto,
            `Máximo ${TIENDA.checkout.maxUnidadesPorProducto} por producto`,
          ),
      }),
    )
    .min(1, "El carrito está vacío")
    .max(40, "Demasiados productos en un solo pedido"),
});

export type PeticionPedido = z.infer<typeof esquemaPeticionPedido>;

export function etiquetaFranja(valor: string): string {
  return FRANJAS.find((f) => f.valor === valor)?.etiqueta ?? valor;
}

export function etiquetaMetodo(valor: string): string {
  return ETIQUETAS_METODO[valor] ?? valor;
}
