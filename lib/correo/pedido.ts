import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { formatearCOP, formatearFechaSola } from "@/lib/formato";
import { etiquetaFranja, etiquetaMetodo } from "@/lib/validaciones/pedido";
import { SITIO, enlaceWhatsapp, hayWhatsapp } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";
import {
  COLORES_CORREO,
  CORREO_COPIA,
  CORREO_TIENDA,
  enviarCorreo,
  esc,
  plantilla,
} from "@/lib/correo/enviar";

/**
 * Confirmación de pago al comprador.
 *
 * Se dispara desde los webhooks y desde el cobro manual, SIEMPRE después de
 * que `fulfill_paid_order` haya aplicado el cobro. Nunca antes: un correo que
 * diga "recibimos tu pago" cuando el pago todavía no cuadró es peor que no
 * mandar nada.
 *
 * No lanza nunca. Si el correo falla, el pedido ya está pagado y la venta
 * hecha; lo único que se pierde es el aviso, y eso queda en el log.
 */

type FilaPedido = {
  order_number: string;
  email: string;
  customer_name: string | null;
  recipient_name: string | null;
  total_cop: number;
  delivery_date: string | null;
  delivery_slot: string | null;
};

type FilaItem = {
  product_name: string;
  variant_name: string;
  quantity: number;
  unit_price_cop: number;
};

export async function enviarConfirmacionDePago(numeroPedido: string): Promise<void> {
  try {
    const { rows } = await db.execute<FilaPedido>(sql`
      select order_number, email, customer_name, recipient_name,
             total_cop, delivery_date::text as delivery_date, delivery_slot
        from public.orders
       where order_number = ${numeroPedido}
       limit 1
    `);

    const pedido = rows[0];
    if (!pedido?.email) {
      console.warn(`correo: ${numeroPedido} no tiene correo de comprador`);
      return;
    }

    const { rows: items } = await db.execute<FilaItem>(sql`
      select product_name, variant_name, quantity, unit_price_cop
        from public.order_items
       where order_id = (select id from public.orders where order_number = ${numeroPedido})
       order by product_name
    `);

    const lineas = items
      .map(
        (i) =>
          `<tr>
             <td style="padding:6px 0;font-size:14px">${esc(i.product_name)}${
               i.variant_name && i.variant_name !== i.product_name
                 ? ` <span style="color:${COLORES_CORREO.colorSuave}">· ${esc(i.variant_name)}</span>`
                 : ""
             } <span style="color:${COLORES_CORREO.colorSuave}">× ${i.quantity}</span></td>
             <td style="padding:6px 0;text-align:right;font-size:14px;white-space:nowrap">${formatearCOP(
               i.unit_price_cop * i.quantity,
             )}</td>
           </tr>`,
      )
      .join("");

    const entrega =
      pedido.delivery_date && pedido.delivery_slot
        ? `<p style="margin:0 0 16px;font-size:15px">Entrega el <strong>${esc(
            formatearFechaSola(pedido.delivery_date),
          )}</strong>, ${esc(etiquetaFranja(pedido.delivery_slot).toLowerCase())}.</p>`
        : "";

    const nombre = pedido.customer_name?.split(" ")[0] ?? "";

    const cuerpo = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
        ${nombre ? `${esc(nombre)}, r` : "R"}ecibimos tu pago. Ya estamos preparando el pedido
        <strong>${esc(pedido.order_number)}</strong>${
          pedido.recipient_name ? ` para ${esc(pedido.recipient_name)}` : ""
        }.
      </p>
      ${entrega}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:0 0 12px">
        ${lineas}
      </table>
      <p style="margin:0 0 20px;font-size:16px;text-align:right">
        Total pagado: <strong>${formatearCOP(pedido.total_cop)}</strong>
      </p>
      <p style="margin:0 0 8px;font-size:14px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
        Te escribimos por WhatsApp el día de la entrega para coordinar la hora.
      </p>`;

    await enviarCorreo({
      para: pedido.email,
      // Nadie recibe en pedidos@: sin esto, quien responde al correo se topa
      // con un rebote. Las respuestas van al buzón real del negocio.
      responderA: CORREO_TIENDA,
      asunto: `Recibimos tu pago · ${pedido.order_number}`,
      html: plantilla({ titulo: "Pago confirmado", cuerpo }),
      texto:
        `Recibimos tu pago del pedido ${pedido.order_number}.\n` +
        `Total: ${formatearCOP(pedido.total_cop)}\n` +
        (pedido.delivery_date
          ? `Entrega: ${formatearFechaSola(pedido.delivery_date)}\n`
          : "") +
        `\n${SITIO.dominio}`,
    });
  } catch (e) {
    // Un fallo aquí NO puede propagarse: quien llama ya aplicó el cobro, y
    // lanzar haría que el webhook devolviera 500 y la pasarela reintentara un
    // pago que ya está bien aplicado.
    console.error(
      `correo: no se pudo confirmar ${numeroPedido} — ${e instanceof Error ? e.name : "desconocido"}`,
    );
  }
}

// ============================================================================
// Datos de un pedido para armar los correos
// ============================================================================

type FilaPedidoCompleto = {
  order_number: string;
  status: string;
  email: string;
  customer_name: string | null;
  phone: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  shipping_address: {
    ciudad?: string | null;
    line1?: string | null;
    notes?: string | null;
  } | null;
  gift_message: string | null;
  payment_method: string | null;
  total_cop: number;
  shipping_cop: number;
  delivery_date: string | null;
  delivery_slot: string | null;
};

async function datosPedido(
  numeroPedido: string,
): Promise<{ pedido: FilaPedidoCompleto; items: FilaItem[] } | null> {
  const { rows } = await db.execute<FilaPedidoCompleto>(sql`
    select order_number, status, email, customer_name, phone,
           recipient_name, recipient_phone, shipping_address,
           gift_message, payment_method, total_cop, shipping_cop,
           delivery_date::text as delivery_date, delivery_slot
      from public.orders
     where order_number = ${numeroPedido}
     limit 1
  `);
  const pedido = rows[0];
  if (!pedido) return null;

  const { rows: items } = await db.execute<FilaItem>(sql`
    select product_name, variant_name, quantity, unit_price_cop
      from public.order_items
     where order_id = (select id from public.orders where order_number = ${numeroPedido})
     order by product_name
  `);

  return { pedido, items };
}

/** Filas de productos como <tr> para las tablas de los correos. */
function filasItems(items: FilaItem[]): string {
  return items
    .map(
      (i) =>
        `<tr>
           <td style="padding:6px 0;font-size:14px">${esc(i.product_name)}${
             i.variant_name && i.variant_name !== i.product_name
               ? ` <span style="color:${COLORES_CORREO.colorSuave}">· ${esc(i.variant_name)}</span>`
               : ""
           } <span style="color:${COLORES_CORREO.colorSuave}">× ${i.quantity}</span></td>
           <td style="padding:6px 0;text-align:right;font-size:14px;white-space:nowrap">${formatearCOP(
             i.unit_price_cop * i.quantity,
           )}</td>
         </tr>`,
    )
    .join("");
}

function bloqueEntrega(fecha: string | null, franja: string | null): string {
  return fecha && franja
    ? `<p style="margin:0 0 16px;font-size:15px">Entrega el <strong>${esc(
        formatearFechaSola(fecha),
      )}</strong>, ${esc(etiquetaFranja(franja).toLowerCase())}.</p>`
    : "";
}

// ============================================================================
// Correo al COMPRADOR: "recibimos tu orden" (pendiente de pago)
// ============================================================================

/**
 * Se envía al crear el pedido, antes de que el pago se confirme. Con pasarela
 * lleva el botón para retomar el pago; en contra-entrega solo confirma que la
 * orden entró. La confirmación de pago va aparte (enviarConfirmacionDePago).
 */
export async function enviarOrdenRecibida(
  numeroPedido: string,
  urlPago?: string | null,
): Promise<void> {
  try {
    const datos = await datosPedido(numeroPedido);
    if (!datos?.pedido.email) return;
    const { pedido, items } = datos;

    const nombre = pedido.customer_name?.split(" ")[0] ?? "";
    const contraEntrega = pedido.payment_method === "contra-entrega";

    const cuerpo = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
        ${nombre ? `${esc(nombre)}, t` : "T"}u orden <strong>${esc(pedido.order_number)}</strong>
        quedó registrada. ${
          contraEntrega
            ? "La confirmaremos por WhatsApp y pagas al recibir."
            : "Está esperando la confirmación del pago; en cuanto lo recibamos te avisamos por este mismo correo."
        }
      </p>
      ${bloqueEntrega(pedido.delivery_date, pedido.delivery_slot)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:0 0 12px">
        ${filasItems(items)}
      </table>
      <p style="margin:0 0 20px;font-size:16px;text-align:right">
        Total: <strong>${formatearCOP(pedido.total_cop)}</strong>
      </p>
      ${
        hayWhatsapp
          ? `<p style="margin:0 0 8px;font-size:14px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
               Recuerda confirmar tu pedido por WhatsApp para asegurar la fecha y la
               dirección de entrega.
             </p>`
          : ""
      }`;

    await enviarCorreo({
      para: pedido.email,
      responderA: CORREO_TIENDA,
      asunto: `Recibimos tu orden · ${pedido.order_number}`,
      html: plantilla({
        titulo: "Recibimos tu orden",
        cuerpo,
        accion:
          urlPago && !contraEntrega
            ? { texto: "Reintentar pago", url: urlPago }
            : undefined,
      }),
      texto:
        `Recibimos tu orden ${pedido.order_number}.\n` +
        `Total: ${formatearCOP(pedido.total_cop)}\n` +
        (urlPago && !contraEntrega ? `Retomar el pago: ${urlPago}\n` : "") +
        `\n${SITIO.dominio}`,
    });
  } catch (e) {
    console.error(
      `correo: no se pudo avisar la orden ${numeroPedido} al comprador — ${
        e instanceof Error ? e.name : "desconocido"
      }`,
    );
  }
}

// ============================================================================
// Correo al COMPRADOR: el pedido salió / llegó
// ============================================================================

/**
 * Aviso de que el pedido cambió a "enviado" o "entregado".
 *
 * Quien hace un pedido programado vive pendiente de "¿ya salió?, ¿ya llegó?".
 * Antes la única respuesta era que alguien del equipo escribiera a mano; este
 * correo lo automatiza. No lanza: si falla, el estado ya cambió y solo se
 * pierde el aviso (queda en el log).
 */
export async function enviarAvisoEntrega(
  numeroPedido: string,
  estado: "enviado" | "entregado",
): Promise<void> {
  try {
    const datos = await datosPedido(numeroPedido);
    if (!datos?.pedido.email) return;
    const { pedido } = datos;

    const nombre = pedido.customer_name?.split(" ")[0] ?? "";
    const paraQuien = pedido.recipient_name ? ` para ${esc(pedido.recipient_name)}` : "";

    const enviado = estado === "enviado";
    const titulo = enviado ? "Tu pedido va en camino" : "Tu pedido fue entregado";
    // Solo prometemos "llega hoy" cuando la tienda entrega el mismo día
    // (tiempoTransitoDias[1] === 0). Con tránsito de varios días, ese texto
    // sería falso.
    const llegaHoy: boolean = TIENDA.entregas.tiempoTransitoDias[1] <= 0;

    const cuerpo = enviado
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">
           ${nombre ? `${esc(nombre)}, t` : "T"}u pedido <strong>${esc(pedido.order_number)}</strong>${paraQuien}
           ya salió con el transportista. ${
             llegaHoy
               ? "Llega hoy dentro de la franja acordada."
               : "Llega dentro de la franja acordada."
           }
         </p>
         ${bloqueEntrega(pedido.delivery_date, pedido.delivery_slot)}
         ${
           hayWhatsapp
             ? `<p style="margin:0 0 8px;font-size:14px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
                  Si necesitas coordinar algo de la entrega, respóndenos por WhatsApp.
                </p>`
             : ""
         }`
      : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">
           ${nombre ? `${esc(nombre)}, t` : "T"}u pedido <strong>${esc(pedido.order_number)}</strong>${paraQuien}
           fue entregado. ¡Gracias por tu compra!
         </p>
         <p style="margin:0 0 8px;font-size:14px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
           ${
             hayWhatsapp
               ? "Si algo no salió como esperabas, escríbenos por WhatsApp y lo resolvemos."
               : "Si algo no salió como esperabas, contáctanos y lo resolvemos."
           }
         </p>`;

    const enlaceSoporte = enlaceWhatsapp();

    await enviarCorreo({
      para: pedido.email,
      responderA: CORREO_TIENDA,
      asunto: `${enviado ? "Va en camino" : "Entregado"} · ${pedido.order_number}`,
      html: plantilla({
        titulo,
        cuerpo,
        accion: enlaceSoporte
          ? { texto: "Escríbenos por WhatsApp", url: enlaceSoporte }
          : undefined,
      }),
      texto:
        `${titulo}: ${pedido.order_number}.\n` +
        (pedido.delivery_date
          ? `Entrega: ${formatearFechaSola(pedido.delivery_date)}\n`
          : "") +
        `\n${SITIO.dominio}`,
    });
  } catch (e) {
    console.error(
      `correo: no se pudo avisar la entrega ${numeroPedido} (${estado}) — ${
        e instanceof Error ? e.name : "desconocido"
      }`,
    );
  }
}

// ============================================================================
// Correo a la TIENDA: aviso de pedido (nuevo o confirmado)
// ============================================================================

/**
 * Aviso interno de operaciones. Llega a CORREO_TIENDA con copia a CORREO_COPIA.
 * Se manda al entrar el pedido (estado 'pendiente') y otra vez cuando el pago
 * se confirma (estado 'pagado'): así el equipo sabe qué pedidos ya están
 * pagados y cuáles siguen esperando. Trae los datos operativos completos.
 */
export async function enviarAvisoTienda(numeroPedido: string): Promise<void> {
  if (!CORREO_TIENDA) {
    console.error("correo: EMAIL_TIENDA no está definida: aviso interno de pedido no enviado");
    return;
  }

  try {
    const datos = await datosPedido(numeroPedido);
    if (!datos) return;
    const { pedido, items } = datos;

    const pagado = pedido.status === "pagado";
    const dir = pedido.shipping_address;
    const fila = (etiq: string, valor: string) =>
      `<tr>
         <td style="padding:4px 12px 4px 0;font-size:14px;color:${COLORES_CORREO.colorSuave};white-space:nowrap;vertical-align:top">${etiq}</td>
         <td style="padding:4px 0;font-size:14px;vertical-align:top">${valor}</td>
       </tr>`;

    const datosTabla = [
      fila("Estado", pagado ? "<strong>PAGADO</strong>" : "Pendiente de pago"),
      fila("Método", esc(etiquetaMetodo(pedido.payment_method ?? ""))),
      pedido.delivery_date && pedido.delivery_slot
        ? fila(
            "Entrega",
            `${esc(formatearFechaSola(pedido.delivery_date))} · ${esc(
              etiquetaFranja(pedido.delivery_slot),
            )}`,
          )
        : "",
      fila(
        "Recibe",
        `${esc(pedido.recipient_name ?? "—")}${
          pedido.recipient_phone ? ` · ${esc(pedido.recipient_phone)}` : ""
        }`,
      ),
      fila(
        "Dirección",
        `${esc(dir?.line1 ?? "—")}${dir?.ciudad ? `, ${esc(dir.ciudad)}` : ""}`,
      ),
      dir?.notes ? fila("Indicaciones", esc(dir.notes)) : "",
      pedido.gift_message ? fila("Mensaje", `“${esc(pedido.gift_message)}”`) : "",
      fila(
        "Compra",
        `${esc(pedido.customer_name ?? "—")}${
          pedido.phone ? ` · ${esc(pedido.phone)}` : ""
        } · ${esc(pedido.email)}`,
      ),
    ].join("");

    const cuerpo = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
        ${
          pagado
            ? "Pago confirmado. Este pedido ya se puede preparar."
            : "Nuevo pedido en la tienda. Aún no ha confirmado el pago."
        }
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:0 0 16px">${datosTabla}</table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:0 0 12px">
        ${filasItems(items)}
      </table>
      <p style="margin:0 0 4px;font-size:16px;text-align:right">
        Total: <strong>${formatearCOP(pedido.total_cop)}</strong>
      </p>
      <p style="margin:0;font-size:13px;color:${COLORES_CORREO.colorSuave};text-align:right">
        Envío: ${formatearCOP(pedido.shipping_cop)}
      </p>`;

    /**
     * El botón escribe al CLIENTE (el teléfono del pedido), no a la tienda:
     * `enlaceWhatsapp()` sin argumento da el WhatsApp propio de la tienda, que
     * aquí no sirve de nada porque este correo YA llega a la tienda. Se omite
     * si el pedido no trae teléfono.
     */
    const telefonoCliente = pedido.phone?.replace(/\D/g, "") || null;
    const whatsappCliente = telefonoCliente
      ? `https://wa.me/${telefonoCliente.startsWith("57") ? telefonoCliente : `57${telefonoCliente}`}`
      : null;

    await enviarCorreo({
      para: CORREO_TIENDA,
      copia: CORREO_COPIA,
      // Si el equipo responde, contesta al cliente, no al remitente técnico.
      responderA: pedido.email,
      asunto: `${pagado ? "PAGADO" : "Nuevo pedido"} · ${pedido.order_number} · ${formatearCOP(
        pedido.total_cop,
      )}`,
      html: plantilla({
        titulo: pagado ? "Pedido pagado" : "Nuevo pedido",
        cuerpo,
        accion: whatsappCliente
          ? { texto: "Escribir al cliente por WhatsApp", url: whatsappCliente }
          : undefined,
      }),
      texto:
        `${pagado ? "PAGADO" : "NUEVO PEDIDO"} ${pedido.order_number}\n` +
        `Total: ${formatearCOP(pedido.total_cop)} (envío ${formatearCOP(pedido.shipping_cop)})\n` +
        `Recibe: ${pedido.recipient_name ?? "—"} ${pedido.recipient_phone ?? ""}\n` +
        `Dirección: ${dir?.line1 ?? "—"}${dir?.ciudad ? `, ${dir.ciudad}` : ""}\n` +
        `Compra: ${pedido.customer_name ?? "—"} ${pedido.phone ?? ""} ${pedido.email}\n` +
        `Método: ${etiquetaMetodo(pedido.payment_method ?? "")}`,
    });
  } catch (e) {
    console.error(
      `correo: no se pudo avisar el pedido ${numeroPedido} a la tienda — ${
        e instanceof Error ? e.name : "desconocido"
      }`,
    );
  }
}
