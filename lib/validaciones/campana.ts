import { z } from "zod";

/**
 * Validación de una campaña de temporada.
 *
 * Corre en el SERVIDOR (la server action es un endpoint POST y se puede llamar
 * sin pasar por el formulario), así que aquí están las reglas de verdad, no en
 * el navegador. Reflejan los CHECK de la tabla `campaigns` para fallar con un
 * mensaje legible antes de que Postgres rechace con su error crudo.
 */

const FECHA = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD");

/** Ruta interna de imagen: vacío → null. Debe empezar por "/". */
const RUTA_IMAGEN = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine(
    (v) => v === null || v.startsWith("/"),
    "La imagen debe ser una ruta del sitio, empezando por /",
  );

const HEX = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v.toUpperCase()))
  .refine(
    (v) => v === null || /^#[0-9A-F]{6}$/.test(v),
    "El color debe ser un hexadecimal de 6 dígitos, por ejemplo #1F2937",
  );

const OPCIONAL = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

export const esquemaCampana = z
  .object({
    nombre: z.string().trim().min(1, "Ponle un nombre para reconocerla en el panel").max(120),
    titulo: z.string().trim().min(1, "El título es lo que ve el cliente").max(160),
    cuerpo: z.string().trim().min(1, "Escribe el texto de la campaña").max(2000),
    imagenUrl: RUTA_IMAGEN,
    imagenMovilUrl: RUTA_IMAGEN,
    imagenAlt: OPCIONAL.pipe(z.string().max(300).nullable()),
    colorFondo: HEX,
    ctaLabel: OPCIONAL.pipe(z.string().max(60).nullable()),
    ctaHref: OPCIONAL,
    inicio: FECHA,
    fin: FECHA,
    activa: z.boolean(),
  })
  .refine((d) => d.fin >= d.inicio, {
    message: "La campaña no puede terminar antes de empezar",
    path: ["fin"],
  })
  .refine((d) => (d.ctaLabel === null) === (d.ctaHref === null), {
    // Igual que el CHECK campaigns_cta_ck: botón sin destino no lleva a nada,
    // destino sin texto no se puede pulsar.
    message: "El botón necesita texto Y destino, o ninguno de los dos",
    path: ["ctaLabel"],
  })
  .refine((d) => d.ctaHref === null || d.ctaHref.startsWith("/") || d.ctaHref.startsWith("https://"), {
    message: "El destino del botón debe ser una ruta del sitio (/tienda/) o un enlace https://",
    path: ["ctaHref"],
  });

export type CampanaValidada = z.output<typeof esquemaCampana>;
