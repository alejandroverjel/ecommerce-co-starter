"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { exigirPersonal } from "@/lib/admin/guardia";
import { optimizarImagen } from "@/lib/imagenes/optimizar";

/**
 * Subida de imágenes desde el panel.
 *
 * Guarda en el volumen persistente (`/data/uploads/subidas`), que sobrevive a
 * los deploys, y lo sirve el route handler de `/uploads/*`. Optimiza a WebP
 * antes de guardar —igual que las fotos importadas— para que ninguna imagen
 * gigante vuelva a ahogar el optimizador de next/image.
 *
 * El nombre es el hash del contenido: dos subidas de la misma foto no la
 * duplican, y el nombre es estable, así que la caché inmutable del route
 * handler nunca sirve una versión vieja.
 */

const DIR = process.env.UPLOADS_DIR ?? "/data/uploads";
const SUBIDAS = join(DIR, "subidas");

const TIPOS_ACEPTADOS = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB antes de optimizar

export type ResultadoSubida =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * `destino` decide el ancho máximo: un banner de campaña se ve a todo el ancho
 * (2000 px), una foto de producto en una tarjeta no necesita tanto (1400 px).
 */
export async function subirImagen(datos: FormData): Promise<ResultadoSubida> {
  try {
    await exigirPersonal();

    const archivo = datos.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) {
      return { ok: false, error: "No llegó ninguna imagen." };
    }
    if (!TIPOS_ACEPTADOS.has(archivo.type)) {
      return { ok: false, error: "Formato no soportado. Usa JPG, PNG o WebP." };
    }
    if (archivo.size > MAX_BYTES) {
      return { ok: false, error: "La imagen pesa más de 12 MB. Usa una más liviana." };
    }

    const destino = String(datos.get("destino") ?? "");
    const maxAncho = destino === "campana" ? 2000 : 1400;

    const entrada = Buffer.from(await archivo.arrayBuffer());
    // Optimiza y fuerza WebP: la función conserva el formato de origen, así que
    // se re-envuelve en sharp para salir siempre en webp con nombre .webp.
    const optimizada = await optimizarImagen(entrada, { maxAncho });
    const { default: sharp } = await import("sharp");
    const webp = await sharp(optimizada, { failOn: "none" }).webp({ quality: 82 }).toBuffer();

    const hash = createHash("sha256").update(webp).digest("hex").slice(0, 16);
    const nombre = `${hash}.webp`;

    await mkdir(SUBIDAS, { recursive: true });
    await writeFile(join(SUBIDAS, nombre), webp);

    return { ok: true, url: `/uploads/subidas/${nombre}` };
  } catch (e) {
    console.error("admin/subir-imagen:", e);
    return { ok: false, error: "No se pudo subir la imagen. Intenta de nuevo." };
  }
}
