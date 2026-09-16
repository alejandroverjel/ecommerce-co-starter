import "server-only";

import { Resend } from "resend";

import { SITIO, MARCA, CONTACTO, hayWhatsapp } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";

/**
 * ============================================================================
 * Envío de correo — Resend
 * ============================================================================
 *
 * INERTE SIN LLAVE, A PROPÓSITO. Sin `RESEND_API_KEY` no se envía nada y no se
 * lanza: la tienda funciona igual, solo que sin correos. Es el mismo criterio
 * que con las pasarelas —un servicio externo a medio configurar no debe tumbar
 * una compra— pero con una diferencia importante: aquí el fallo se REGISTRA
 * siempre, porque un correo que no sale es invisible para todos.
 *
 * NINGÚN ENVÍO BLOQUEA UNA COMPRA. Quien llama a estas funciones ya terminó lo
 * suyo: el pedido está grabado y el cobro aplicado. Si Resend está caído, el
 * cliente no se entera y la venta sigue en pie.
 */

/** Remitente. El dominio debe estar verificado en Resend o rebota todo. */
function remitente(): string {
  return process.env.EMAIL_FROM ?? `pedidos@${new URL(SITIO.dominio).hostname}`;
}

/**
 * Buzón de operaciones: a dónde llega el aviso de cada pedido. SIN RESPALDO:
 * a diferencia del correo público de contacto (CONTACTO.correo, que sí tiene
 * un valor de fábrica), este es un dato operativo de cada tienda y no debe
 * copiarse por accidente a un buzón ajeno. Si falta, `enviarAvisoTienda` lo
 * registra y no manda el aviso interno; los correos al cliente siguen igual.
 */
export const CORREO_TIENDA = process.env.EMAIL_TIENDA || null;
export const CORREO_COPIA = process.env.EMAIL_COPIA || undefined;

let clienteMemo: Resend | null | undefined;

function cliente(): Resend | null {
  if (clienteMemo !== undefined) return clienteMemo;
  const llave = process.env.RESEND_API_KEY;
  clienteMemo = llave ? new Resend(llave) : null;
  return clienteMemo;
}

export function hayCorreoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

type Envio = {
  para: string | string[];
  asunto: string;
  html: string;
  texto: string;
  /** Copia visible (aparece en el correo). */
  copia?: string | string[];
  /** A quién responde el cliente si contesta el correo. Null = sin responderA. */
  responderA?: string | null;
};

/**
 * Manda un correo. Nunca lanza: devuelve si salió o no.
 *
 * El asunto y el destinatario sí se registran cuando falla —hacen falta para
 * reenviarlo a mano— pero el cuerpo no: lleva la dirección de entrega y el
 * mensaje de la tarjeta.
 */
export async function enviarCorreo({
  para,
  asunto,
  html,
  texto,
  copia,
  responderA,
}: Envio): Promise<boolean> {
  const resend = cliente();

  if (!resend) {
    console.warn(`correo: sin RESEND_API_KEY, no se envió "${asunto}" a ${para}`);
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: remitente(),
      to: para,
      cc: copia,
      replyTo: responderA ?? undefined,
      subject: asunto,
      html,
      text: texto,
    });

    if (error) {
      console.error(`correo: Resend rechazó "${asunto}" para ${para} — ${error.message}`);
      return false;
    }

    return true;
  } catch (e) {
    console.error(
      `correo: fallo enviando "${asunto}" a ${para} — ${e instanceof Error ? e.name : "desconocido"}`,
    );
    return false;
  }
}

// ============================================================================
// Plantilla
// ============================================================================

/** Paleta de los correos transaccionales. Configurable por tienda. */
export const COLORES_CORREO = TIENDA.correo;

/**
 * Envoltura común. Estilos EN LÍNEA porque los clientes de correo descartan
 * las hojas de estilo, y tabla de una columna porque Outlook no entiende
 * flexbox. Nada de esto se parece al CSS del sitio, y es correcto que así sea.
 */
export function plantilla({
  titulo,
  cuerpo,
  accion,
}: {
  titulo: string;
  /** HTML ya escapado por quien lo arma. */
  cuerpo: string;
  accion?: { texto: string; url: string };
}): string {
  const boton = accion
    ? `<tr><td style="padding:8px 0 24px">
         <a href="${accion.url}"
            style="display:inline-block;background:${COLORES_CORREO.colorPrimario};color:#fff;text-decoration:none;
                   padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px">
           ${accion.texto}
         </a>
       </td></tr>`
    : "";

  // Logo si la tienda tiene uno para correo (los clientes de correo no
  // soportan SVG/WebP); si no, el nombre en texto.
  const cabecera = MARCA.logoCorreo
    ? `<!-- PNG y no WebP: varios clientes de correo (Outlook, algunos webmail)
           no pintan WebP. Va sobre blanco por si el logo tiene fondo
           transparente y el cliente fuerza fondo claro. -->
       <img src="${SITIO.dominio}${MARCA.logoCorreo}"
            alt="${esc(SITIO.nombre)}" width="140"
            style="display:block;margin:0 auto;width:140px;height:auto;border:0;background:#ffffff">`
    : `<span style="font-size:20px;font-weight:600;color:${COLORES_CORREO.colorTexto}">${esc(SITIO.nombre)}</span>`;

  const contacto = hayWhatsapp
    ? `¿Dudas? Escríbenos por WhatsApp al ${CONTACTO.whatsappFormateado}.`
    : `¿Dudas? Escríbenos a ${CONTACTO.correo}.`;

  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORES_CORREO.colorTexto}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <tr><td style="padding:0 0 20px;text-align:center">
      ${cabecera}
    </td></tr>
    <tr><td>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${titulo}</h1>
      ${cuerpo}
    </td></tr>
    ${boton}
    <tr><td style="padding-top:24px;border-top:1px solid #eee;font-size:13px;color:${COLORES_CORREO.colorSuave}">
      <p style="margin:0 0 4px">${contacto}</p>
      <p style="margin:0"><a href="${SITIO.dominio}" style="color:${COLORES_CORREO.colorPrimario};text-decoration:none">${new URL(SITIO.dominio).hostname}</a></p>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Escapa texto que viene de la base antes de meterlo en el HTML del correo. */
export function esc(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
