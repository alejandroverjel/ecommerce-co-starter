import sharp from "sharp";

/**
 * Optimizador de imágenes reutilizable (importación + script de mantenimiento).
 *
 * Las fotos que vienen de una migración o de otra plataforma suelen pesar de
 * sobra (banners de varios MB, PNGs de producto pesados). A ese tamaño el
 * optimizador de `next/image` se ahoga y en móvil las fotos no alcanzan a
 * cargar. Aquí se reducen una sola vez, al entrar al proyecto, para que el
 * servidor sirva algo sano.
 *
 * Conserva el formato original (PNG→PNG, JPG→JPG, WebP→WebP) para no tener que
 * tocar las URLs guardadas en la base. Corrige la orientación EXIF y solo
 * reduce el ancho si la imagen es más grande que `maxAncho`.
 */

export type FormatoImagen = "png" | "jpeg" | "webp";

export type OpcionesOptimizacion = {
  /** Ancho máximo en píxeles. Fotos más anchas se reducen; el resto no. */
  maxAncho?: number;
  /** Calidad 1–100 para JPEG/WebP y el cuantizador de PNG. */
  calidad?: number;
};

/**
 * Devuelve la versión optimizada del buffer. Si por lo que sea saliera más
 * pesada que la original (imagen ya diminuta), devuelve la original: nunca
 * empeora el archivo.
 */
export async function optimizarImagen(
  entrada: Buffer,
  opciones: OpcionesOptimizacion = {},
): Promise<Buffer> {
  const { maxAncho = 1400, calidad = 82 } = opciones;

  const img = sharp(entrada, { failOn: "none" }).rotate();
  const meta = await img.metadata();

  let pipe = img;
  if (meta.width && meta.width > maxAncho) {
    pipe = pipe.resize({ width: maxAncho, withoutEnlargement: true });
  }

  if (meta.format === "png") {
    pipe = pipe.png({ compressionLevel: 9, palette: true, quality: calidad });
  } else if (meta.format === "webp") {
    pipe = pipe.webp({ quality: calidad });
  } else {
    pipe = pipe.jpeg({ quality: calidad, mozjpeg: true });
  }

  const salida = await pipe.toBuffer();
  return salida.length < entrada.length ? salida : entrada;
}
