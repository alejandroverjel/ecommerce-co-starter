import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { Readable } from "node:stream";

/**
 * Sirve las imágenes SUBIDAS desde el volumen persistente (`/data/uploads`).
 *
 * Las imágenes horneadas en la imagen (`public/uploads/...`) las sirve Next
 * como estáticos y NUNCA llegan aquí: un archivo de `public/` gana sobre
 * cualquier route handler de la misma ruta. Este handler solo se ejecuta para
 * rutas `/uploads/*` que NO existen en `public/` — es decir, lo que el panel
 * sube después del build, que de otro modo daría 404 (el volumen no lo servía
 * nadie: era el bug del pipeline de imágenes).
 *
 * Corre en Node (no Edge) porque lee del sistema de archivos.
 */
export const runtime = "nodejs";

const DIR = process.env.UPLOADS_DIR ?? "/data/uploads";

const TIPOS: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ruta: string[] }> },
) {
  const { ruta } = await params;

  // Path traversal: se normaliza y se exige que el resultado siga DENTRO de
  // DIR. Un "../" que se escape del directorio se rechaza sin tocar disco.
  const rel = normalize(ruta.join("/"));
  if (rel.startsWith("..") || rel.includes("\0")) {
    return new Response("No encontrado", { status: 404 });
  }

  // Los comentarios turbopackIgnore evitan que el trazado de archivos (NFT)
  // tome esta ruta dinámica como "todo el proyecto" y meta fuentes y docs en
  // la salida standalone. DIR es un volumen de ejecución, no parte del build.
  const absoluto = join(/*turbopackIgnore: true*/ DIR, rel);
  if (!absoluto.startsWith(join(/*turbopackIgnore: true*/ DIR) + "/")) {
    return new Response("No encontrado", { status: 404 });
  }

  const tipo = TIPOS[extname(absoluto).toLowerCase()];
  if (!tipo) return new Response("No encontrado", { status: 404 });

  if (!existsSync(/*turbopackIgnore: true*/ absoluto)) return new Response("No encontrado", { status: 404 });

  const info = statSync(/*turbopackIgnore: true*/ absoluto);
  if (!info.isFile()) return new Response("No encontrado", { status: 404 });

  // Las subidas van con nombre único (hash), así que no cambian: caché larga.
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ absoluto)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(info.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
