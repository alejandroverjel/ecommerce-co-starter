/**
 * Formato de moneda y fechas para Colombia.
 *
 * Regla del proyecto: el dinero siempre es un entero de pesos. Nunca float,
 * nunca decimales. El peso colombiano no usa centavos en retail.
 */

const FORMATO_COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formatea pesos colombianos: 210000 → "$ 210.000"
 *
 * Usar SIEMPRE esta función, nunca `toLocaleString()` suelto. Así el formato
 * es idéntico en toda la tienda y cambiarlo es un solo lugar.
 */
export function formatearCOP(pesos: number): string {
  return FORMATO_COP.format(pesos);
}

/**
 * Formatea sin el símbolo, para cuando el contexto ya lo deja claro:
 * 210000 → "210.000"
 */
export function formatearCifra(pesos: number): string {
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pesos);
}

const FORMATO_FECHA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "long",
  timeZone: "America/Bogota",
});

/**
 * Formatea un instante (una marca de tiempo real, con hora).
 *
 * NO usar para fechas sin hora: ver `formatearFechaSola`.
 */
export function formatearFecha(fecha: Date | string): string {
  return FORMATO_FECHA.format(typeof fecha === "string" ? new Date(fecha) : fecha);
}

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

/**
 * Fecha CON hora: "2 sept 2026, 9:41 a. m."
 *
 * Para el panel, donde dos pedidos del mismo día son indistinguibles sin la
 * hora y hay que saber si un cobro entró en la mañana o en la noche.
 */
export function formatearFechaHora(fecha: Date | string): string {
  return FORMATO_FECHA_HORA.format(
    typeof fecha === "string" ? new Date(fecha) : fecha,
  );
}

/**
 * Formatea una fecha sin hora, como "2026-08-22".
 *
 * Existe aparte porque `new Date("2026-08-22")` interpreta la cadena como
 * medianoche UTC, y al formatearla en Bogotá (UTC−5) retrocede al día
 * anterior: una entrega del 22 se mostraba como 21.
 *
 * Aquí se construye la fecha con sus partes en hora local, así que no hay
 * ninguna conversión de zona que la pueda correr.
 */
export function formatearFechaSola(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;

  return new Intl.DateTimeFormat("es-CO", { dateStyle: "long" }).format(
    new Date(anio, mes - 1, dia),
  );
}
