import "server-only";

import { formatearCOP } from "@/lib/formato";
import { SITIO, CONTACTO, hayWhatsapp } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";
import { COLORES_CORREO, CORREO_TIENDA, enviarCorreo, esc, plantilla } from "@/lib/correo/enviar";
import { firmarEnlace } from "@/lib/carrito/token";
import type { LineaGuardada } from "@/lib/data/carrito-abandonado";

/**
 * Recordatorio de carrito abandonado.
 *
 * Un solo correo por carrito, entre 4 y 48 horas después de la última señal de
 * vida (ver lib/data/carrito-abandonado.ts). No lleva descuento a propósito:
 * regalar un cupón a quien iba a comprar igual entrena a la gente a abandonar
 * el carrito para que le llegue la rebaja.
 *
 * Lleva SIEMPRE enlace de baja: es contenido comercial y la Ley 1581/2012 exige
 * que la persona pueda salirse en un clic, sin cuenta ni trámite.
 */

export async function enviarCarritoAbandonado(datos: {
  email: string;
  items: LineaGuardada[];
  subtotalCop: number;
}): Promise<boolean> {
  const { email, items, subtotalCop } = datos;
  if (items.length === 0 || subtotalCop <= 0) return false;

  const firmaRecuperar = firmarEnlace("recuperar", email);
  const firmaBaja = firmarEnlace("baja", email);
  const q = encodeURIComponent;

  const urlRecuperar = `${SITIO.dominio}/recuperar-carrito/?correo=${q(email)}&firma=${q(firmaRecuperar)}`;
  const urlBaja = `${SITIO.dominio}/baja-correos/?correo=${q(email)}&firma=${q(firmaBaja)}`;

  const filas = items
    .map(
      (i) =>
        `<tr>
           <td style="padding:6px 0;font-size:14px">${esc(i.nombre)} <span style="color:${COLORES_CORREO.colorSuave}">× ${i.cantidad}</span></td>
           <td style="padding:6px 0;text-align:right;font-size:14px;white-space:nowrap">${formatearCOP(
             i.precioCop * i.cantidad,
           )}</td>
         </tr>`,
    )
    .join("");

  const cuerpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
      Guardamos lo que escogiste. Si quieres, terminamos tu pedido en un
      minuto — hacemos envíos a ${esc(TIENDA.cobertura.descripcion)}${
        TIENDA.checkout.mensajeRegalo ? " con tarjeta personalizada" : ""
      }.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:0 0 12px">
      ${filas}
    </table>
    <p style="margin:0 0 20px;font-size:16px;text-align:right">
      Total: <strong>${formatearCOP(subtotalCop)}</strong>
    </p>
    ${
      hayWhatsapp
        ? `<p style="margin:0 0 8px;font-size:14px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
             Si prefieres, escríbenos por WhatsApp al ${CONTACTO.whatsappFormateado} y
             te ayudamos a completarlo.
           </p>`
        : ""
    }`;

  const pie = `
    <p style="margin:16px 0 0;font-size:12px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
      Recibes este correo porque dejaste tu dirección en nuestro checkout.
      <a href="${urlBaja}" style="color:${COLORES_CORREO.colorSuave}">No quiero volver a recibirlo</a>.
    </p>`;

  return enviarCorreo({
    para: email,
    // Quien responda "sí, ayúdenme a terminarlo" tiene que llegar a alguien:
    // en pedidos@ no hay buzón que reciba.
    responderA: CORREO_TIENDA,
    asunto: "¿Se te quedó algo en el carrito?",
    html: plantilla({
      titulo: "¿Se te quedó algo?",
      cuerpo: cuerpo + pie,
      accion: { texto: "Terminar mi compra", url: urlRecuperar },
    }),
    texto:
      `Guardamos lo que escogiste (total ${formatearCOP(subtotalCop)}).\n` +
      `Termina tu compra: ${urlRecuperar}\n\n` +
      `Para no recibir más correos: ${urlBaja}`,
  });
}
