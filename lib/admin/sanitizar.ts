import "server-only";

import sanitizeHtml from "sanitize-html";

/**
 * Limpia el HTML de la descripción de un producto antes de guardarlo.
 *
 * La ficha pública lo pinta con `dangerouslySetInnerHTML`, así que lo que se
 * guarda aquí se ejecuta en el navegador de cada visitante —y del admin cuando
 * abre la ficha—. Que el panel esté detrás de contraseña no basta: una cuenta
 * de equipo comprometida no debe poder inyectar código en la tienda.
 *
 * Antes esto era una red de expresiones regulares, y era evadible: `<img/onerror=…>`
 * (con `/` en vez de espacio) y `href="&#106;avascript:…"` (entidad HTML)
 * pasaban intactos. Se reemplazó por un parser real (`sanitize-html`) con lista
 * blanca: lo que no está permitido se descarta, no se intenta "arreglar".
 *
 * server-only: `sanitize-html` es una librería de Node y no debe entrar al
 * bundle del navegador.
 */

const CONFIG: sanitizeHtml.IOptions = {
  // Solo etiquetas de formato. Nada de script/style/iframe/form/etc.
  allowedTags: [
    "p", "br", "hr",
    "strong", "b", "em", "i", "u", "s",
    "ul", "ol", "li",
    "a", "blockquote",
    "h2", "h3", "h4",
    "img",
  ],
  allowedAttributes: {
    // rel y target van aquí además del transform: sanitize-html filtra los
    // atributos DESPUÉS de transformar, así que sin listarlos se caerían.
    a: ["href", "title", "rel", "target"],
    // Sin `style`: un `<span style="color:#000">` guardado desde un editor
    // visual importado rompería el modo oscuro. Sin `onerror` ni ningún on*:
    // no están en la lista, así que se descartan.
    img: ["src", "alt", "width", "height"],
  },
  // javascript:, vbscript:, data: quedan fuera. `data:` también: un
  // data:text/html es un XSS con otro traje.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  // Permite rutas relativas (imágenes propias en /uploads).
  allowProtocolRelative: false,
  // Todo enlace guardado por el equipo se abre aparte y sin pasar autoridad.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
  disallowedTagsMode: "discard",
};

export function limpiarHtml(html: string): { html: string; cambiado: boolean } {
  const limpio = sanitizeHtml(html, CONFIG);
  return { html: limpio, cambiado: limpio !== html };
}
