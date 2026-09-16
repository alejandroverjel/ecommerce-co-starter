import { z } from "zod";

/**
 * Validación de un cupón desde el panel.
 *
 * Corre en el SERVIDOR. Refleja los CHECK de la tabla `coupons` para fallar
 * con un mensaje legible antes de que Postgres rechace con su error crudo.
 *
 * ALCANCE: la UI del panel solo crea cupones de alcance `orden` (sobre el
 * total del pedido), que son los de marketing habituales — BIENVENIDA10,
 * ENVIOGRATIS. Los de categoría o producto se pueden crear por SQL;
 * exponerlos en el formulario exige un selector de categorías/productos que
 * no vale la pena hasta que el negocio los pida.
 */

const OPCIONAL_ENTERO = (etiqueta: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[.\s]/g, ""))
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d+$/.test(v), `${etiqueta} debe ser un número entero`)
    .transform((v) => (v === null ? null : Number(v)));

const FECHA_OPCIONAL = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine(
    (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
    "La fecha debe tener el formato AAAA-MM-DD",
  );

export const esquemaCupon = z
  .object({
    /** El código que teclea el cliente. Se guarda tal cual; el índice único es
     *  case-insensitive, así que "navidad" y "NAVIDAD" son el mismo. */
    code: z
      .string()
      .trim()
      .min(3, "El código necesita al menos 3 caracteres")
      .max(40)
      .regex(/^[A-Za-z0-9]+$/, "Solo letras y números, sin espacios ni símbolos"),
    description: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === "" ? null : v)),
    type: z.enum(["porcentaje", "monto_fijo", "envio_gratis"]),
    /**
     * Se escribe en la unidad natural: "10" para 10 % o para $10 según el tipo.
     * Para porcentaje se convierte a puntos básicos (10 → 1000). Para envío
     * gratis se ignora.
     */
    valorCrudo: z
      .string()
      .trim()
      .transform((v) => v.replace(/[.\s%$]/g, ""))
      .transform((v) => (v === "" ? "0" : v))
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "El valor debe ser un número")
      .transform(Number),
    minSubtotalCop: OPCIONAL_ENTERO("El subtotal mínimo").transform((v) => v ?? 0),
    maxDiscountCop: OPCIONAL_ENTERO("El tope de descuento"),
    usageLimit: OPCIONAL_ENTERO("El límite de usos"),
    usageLimitPerUser: OPCIONAL_ENTERO("El límite por persona"),
    startsAt: FECHA_OPCIONAL,
    endsAt: FECHA_OPCIONAL,
    isActive: z.boolean(),
  })
  .refine(
    (d) => d.type !== "porcentaje" || (d.valorCrudo > 0 && d.valorCrudo <= 100),
    { message: "El porcentaje debe estar entre 1 y 100", path: ["valorCrudo"] },
  )
  .refine((d) => d.type !== "monto_fijo" || d.valorCrudo >= 1, {
    message: "El monto del descuento debe ser mayor a 0",
    path: ["valorCrudo"],
  })
  .refine(
    (d) => d.startsAt === null || d.endsAt === null || d.startsAt < d.endsAt,
    { message: "La fecha de fin debe ser posterior a la de inicio", path: ["endsAt"] },
  );

export type CuponValidado = z.output<typeof esquemaCupon>;

/**
 * Traduce el valor escrito por la persona (10 %, $10.000) a lo que guarda la
 * columna `value`: puntos básicos para porcentaje, pesos para monto fijo, 0
 * para envío gratis.
 */
export function valorAColumna(d: CuponValidado): number {
  if (d.type === "porcentaje") return Math.round(d.valorCrudo * 100);
  if (d.type === "monto_fijo") return Math.round(d.valorCrudo);
  return 0;
}

export const TIPOS_CUPON = [
  { valor: "porcentaje", etiqueta: "Porcentaje (%)" },
  { valor: "monto_fijo", etiqueta: "Monto fijo ($)" },
  { valor: "envio_gratis", etiqueta: "Envío gratis" },
] as const;
