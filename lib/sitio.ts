/**
 * Datos del negocio, derivados de `tienda.config.ts`.
 *
 * Este archivo NO guarda datos propios: es una capa de compatibilidad para
 * los ~37 archivos que ya importan SITIO, MARCA, CONTACTO, REDES,
 * GOOGLE_FICHA y enlaceWhatsapp. Para una tienda nueva se edita
 * `tienda.config.ts`, nunca este archivo.
 *
 * Las categorías del catálogo salen de la tabla `categories` vía
 * lib/data/catalogo.ts, no de constantes en este archivo.
 */

import { TIENDA } from "@/tienda.config";

export { TIENDA };

/** "3000000000" -> "300 000 0000". */
function formatearCelular(numero: string): string {
  return numero.replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3");
}

export const SITIO = {
  nombre: TIENDA.nombre,
  dominio: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  descripcion: TIENDA.descripcion,
  ciudad: TIENDA.ubicacion.ciudad,
  departamento: TIENDA.ubicacion.departamento,
  pais: TIENDA.ubicacion.pais,
  idioma: TIENDA.ubicacion.idioma,
  moneda: TIENDA.ubicacion.moneda,
} as const;

export const MARCA = {
  logo: TIENDA.marca.logo,
  logoCorreo: TIENDA.marca.logoCorreo,
  compartir: TIENDA.marca.imagenCompartir,
} as const;

const telefono = TIENDA.contacto.telefono;
const whatsappNumero = TIENDA.contacto.whatsapp;

export const CONTACTO = {
  telefono,
  telefonoFormateado: telefono ? formatearCelular(telefono) : null,
  telefonoInternacional: telefono ? `+57${telefono}` : null,
  whatsapp: whatsappNumero ? `57${whatsappNumero}` : null,
  // Para mostrar en texto ("Escríbenos por WhatsApp al ..."). NO reusar
  // telefonoFormateado: telefono y whatsapp son campos independientes en
  // tienda.config.ts, cualquiera de los dos puede faltar o ser distinto.
  whatsappFormateado: whatsappNumero ? formatearCelular(whatsappNumero) : null,
  mensajeWhatsapp: TIENDA.contacto.mensajeWhatsapp,
  correo: TIENDA.contacto.correo,
} as const;

export const REDES = TIENDA.redes;

export const GOOGLE_FICHA = TIENDA.googleFicha;

/** True si la tienda tiene WhatsApp configurado. */
export const hayWhatsapp = CONTACTO.whatsapp !== null;

/**
 * Enlace directo a WhatsApp con el mensaje precargado.
 * Si se pasa un producto, el mensaje lo menciona. Devuelve null si la tienda
 * no tiene WhatsApp: quien llama debe ocultar el CTA en ese caso.
 */
export function enlaceWhatsapp(producto?: string): string | null {
  if (CONTACTO.whatsapp === null) return null;
  const texto = producto
    ? `Hola, me interesa "${producto}" de ${SITIO.nombre}`
    : CONTACTO.mensajeWhatsapp;
  return `https://wa.me/${CONTACTO.whatsapp}?text=${encodeURIComponent(texto)}`;
}
