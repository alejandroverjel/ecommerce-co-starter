import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { errorPg } from "@/lib/db/errores";
import { esquemaPeticionPedido } from "@/lib/validaciones/pedido";
import { TIENDA } from "@/tienda.config";
import { leerPasarelasHabilitadas } from "@/lib/data/tienda";
import { configuracionCobroWompi, urlCheckoutWompi } from "@/lib/pagos/wompi";
import { firmarRecibo } from "@/lib/pagos/recibo";
import { enviarAvisoTienda, enviarOrdenRecibida } from "@/lib/correo/pedido";
import { marcarRecuperado } from "@/lib/data/carrito-abandonado";
import {
  configuracionCobroMercadoPago,
  crearPreferenciaMercadoPago,
  lineasParaPreferencia,
} from "@/lib/pagos/mercadopago";

/**
 * Crea un pedido pendiente.
 *
 * La lógica de negocio no vive aquí: la resuelve `create_pending_order` dentro
 * de la base, que es donde puede bloquear las variantes y garantizar que dos
 * clientes no compren la última unidad.
 *
 * REGLA: el cliente manda QUÉ y CUÁNTO. Nunca precios. La función relee cada
 * precio de la base, así que editar localStorage no abarata nada.
 */

/**
 * Códigos que levanta `create_pending_order` (RCA01–RCA05, ver el encabezado
 * de 0001_funciones.sql). Se traducen a un mensaje que el comprador entienda y
 * a un status HTTP acorde. Los que no están aquí caen en el genérico 500 y su
 * detalle va SOLO al log, nunca a la pantalla.
 *
 * OJO: el `code` real de Postgres viene envuelto por Drizzle en `.cause`; se
 * desenvuelve con `errorPg()`. Mirarlo de frente —como estaba antes— hacía que
 * TODO error de negocio cayera en el 500 y que la SQL con los datos del
 * comprador se escribiera en el log.
 */
const MENSAJES_CONOCIDOS: Record<string, { texto: string; status: number }> = {
  RCA02: { texto: "No hay suficientes unidades de uno de los productos.", status: 409 },
  RCA03: { texto: "Uno de los productos ya no está disponible. Revisa tu carrito.", status: 409 },
  RCA04: { texto: "Ese cupón no existe o ya venció.", status: 422 },
  RCA05: { texto: "Tu carrito está vacío o la sesión expiró. Vuelve a agregar los productos.", status: 400 },
};

type FilaPedido = {
  order_id: string;
  order_number: string;
  total_cop: number;
};

/** Cookie donde vive el token de checkout entre reintentos del mismo cliente. */
const COOKIE_TOKEN = "checkout_token";

/**
 * Abre el checkout hospedado de la pasarela elegida y devuelve su URL.
 *
 * Devuelve null si no se pudo (pasarela sin configurar, API caída). Quien llama
 * decide qué hacer con eso; aquí no se lanza, porque el pedido ya está creado y
 * tumbar la respuesta perdería su número.
 *
 * Cada pasarela arranca el cobro a su manera: Wompi arma una URL firmada sin
 * hablar con nadie; Mercado Pago crea una preferencia por API, y para eso hace
 * falta el desglose real del pedido.
 */
async function abrirPasarela(
  metodo: string,
  pedidoId: string,
  numeroPedido: string,
  totalCop: number,
): Promise<string | null> {
  try {
    if (metodo === "mercadopago") {
      const cfg = await configuracionCobroMercadoPago();
      if (!cfg) return null;

      // Los ítems y el envío salen de la BASE, no del carrito del cliente: son
      // los precios que create_pending_order acaba de fijar.
      const { rows: itemsCrudos } = await db.execute<{
        product_name: string;
        variant_name: string;
        unit_price_cop: number;
        quantity: number;
      }>(sql`
        select product_name, variant_name, unit_price_cop, quantity
          from public.order_items
         where order_id = ${pedidoId}::uuid
         order by product_name
      `);

      const { rows: totales } = await db.execute<{ shipping_cop: number }>(sql`
        select shipping_cop from public.orders where id = ${pedidoId}::uuid
      `);

      const { lineas, envioCop } = lineasParaPreferencia(
        itemsCrudos.map((i) => ({
          // La variante solo se nombra si aporta algo: en un producto de una
          // sola variante, "Producto — Único" es ruido.
          titulo:
            i.variant_name && i.variant_name !== i.product_name
              ? `${i.product_name} — ${i.variant_name}`
              : i.product_name,
          cantidad: i.quantity,
          precioCop: i.unit_price_cop,
        })),
        totales[0]?.shipping_cop ?? 0,
        totalCop,
        numeroPedido,
      );

      return await crearPreferenciaMercadoPago(
        cfg,
        numeroPedido,
        lineas,
        envioCop,
        totalCop,
      );
    }

    if (metodo === "wompi") {
      const cfg = await configuracionCobroWompi();
      if (!cfg) return null;
      return urlCheckoutWompi(cfg, numeroPedido, totalCop);
    }

    return null;
  } catch (e) {
    // Un timeout de la pasarela no debe tumbar un pedido que ya existe.
    console.error(
      `checkout: no se pudo abrir ${metodo} para ${numeroPedido}`,
      e instanceof Error ? e.name : "",
    );
    return null;
  }
}

/**
 * Rechaza peticiones de otro origen (CSRF).
 *
 * `/api/checkout` es un route handler: `serverActions.allowedOrigins` de
 * next.config no lo cubre, y `Request.json()` no exige content-type, así que un
 * `<form>` cross-origin llegaría sin preflight. Sin este chequeo, la víctima
 * con sesión abierta podría crear pedidos a su nombre desde la página de un
 * atacante. Se exige que el `Origin` (o, en su defecto, el `Referer`) sea del
 * mismo host que la petición.
 */
async function mismoOrigen(): Promise<boolean> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return false;

  const bruto = h.get("origin") ?? h.get("referer");
  if (!bruto) {
    // Sin Origin ni Referer no se puede probar el origen. Un navegador real
    // manda Origin en un POST cross-site; su ausencia es sospechosa, se
    // rechaza. (curl legítimo desde el servidor no pasa por aquí.)
    return false;
  }

  try {
    return new URL(bruto).host === host;
  } catch {
    return false;
  }
}

export async function POST(peticion: Request) {
  if (!(await mismoOrigen())) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const analisis = esquemaPeticionPedido.safeParse(cuerpo);
  if (!analisis.success) {
    // No se devuelven los detalles de validación: el formulario ya valida con
    // el mismo esquema, así que un fallo aquí es manipulación, no un error
    // honesto del usuario.
    console.warn("checkout: datos inválidos", analisis.error.flatten());
    return NextResponse.json({ error: "Revisa los datos del formulario" }, { status: 400 });
  }

  const d = analisis.data;

  // Tope por producto, a prueba de líneas duplicadas. El esquema valida cada
  // línea por separado (max TIENDA.checkout.maxUnidadesPorProducto), pero un
  // POST directo con muchas líneas de la misma variante podría sumar más y
  // create_pending_order las agrega con sum(quantity), reservando esa
  // cantidad. Se agrega por (producto, variante) y se rechaza si alguna suma
  // pasa el tope —el mismo límite que ve el cliente.
  const sumaPorVariante = new Map<string, number>();
  for (const l of d.lineas) {
    const clave = `${l.productoId}:${l.varianteId ?? ""}`;
    sumaPorVariante.set(clave, (sumaPorVariante.get(clave) ?? 0) + l.cantidad);
  }
  if (
    [...sumaPorVariante.values()].some((n) => n > TIENDA.checkout.maxUnidadesPorProducto)
  ) {
    return NextResponse.json(
      {
        error: `Máximo ${TIENDA.checkout.maxUnidadesPorProducto} unidades por producto. Ajusta las cantidades en el carrito.`,
      },
      { status: 400 },
    );
  }

  // El método de pago se valida CONTRA LA BASE, no solo con el enum: el filtro
  // de pasarelas encendidas vivía únicamente en el cliente. Un POST directo, o
  // una pestaña abierta desde antes de apagar Wompi, grababa un pedido con un
  // método que nadie procesa. Retirada la contra entrega, TODO método que llega
  // es una pasarela y tiene que estar encendida.
  {
    const habilitadas = await leerPasarelasHabilitadas();
    if (!habilitadas.includes(d.metodoPago)) {
      return NextResponse.json(
        { error: "Ese método de pago no está disponible ahora. Escoge otro." },
        { status: 409 },
      );
    }
  }

  // Token de checkout, ATADO AL NAVEGADOR por cookie httpOnly.
  //
  // Antes se generaba un UUID nuevo en cada POST, así que la rama de reintento
  // de `create_pending_order` (que busca el pedido anterior por este token)
  // nunca enganchaba: cada "Confirmar" repetido creaba un pedido y unas
  // reservas nuevas. Persistirlo en cookie hace real la idempotencia y corta el
  // agotamiento de inventario a fuerza de reintentos.
  const tarro = await cookies();
  let tokenSesion = tarro.get(COOKIE_TOKEN)?.value;
  if (!tokenSesion || !/^[0-9a-f-]{36}$/.test(tokenSesion)) {
    tokenSesion = crypto.randomUUID();
    tarro.set(COOKIE_TOKEN, tokenSesion, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 30, // 30 min: cubre el ciclo de un checkout, no más.
    });
  }

  // Si hay sesión, el pedido queda atado a la cuenta y aparece en /mi-cuenta/.
  // El id sale de la sesión del SERVIDOR, nunca del cuerpo de la petición:
  // aceptarlo del cliente dejaría poner pedidos a nombre de otro.
  const sesion = await auth();
  const idUsuario = sesion?.user?.id ?? null;

  try {
    const pedido = await db.transaction(async (tx) => {
      // --- 1. El pedido, con toda la lógica de precios y stock en la base ---
      const resultado = await tx.execute<FilaPedido>(sql`
        select order_id, order_number, total_cop
          from public.create_pending_order(
            p_email            => ${d.compradorCorreo},
            p_items            => ${JSON.stringify(
              d.lineas.map((l) => ({
                product_id: l.productoId,
                // La variante que ESCOGIÓ el cliente. La función la respeta si
                // es de ese producto y está activa; si no, cae a la de menor
                // position. Antes se descartaba y podía cobrar otra.
                variant_id: l.varianteId ?? null,
                quantity: l.cantidad,
              })),
            )}::jsonb,
            p_shipping_address => ${JSON.stringify({
              departamento: TIENDA.ubicacion.departamento,
              ciudad: d.municipio,
              line1: d.direccion,
              notes: d.indicaciones ?? null,
            })}::jsonb,
            p_session_token    => ${tokenSesion},
            p_user_id          => ${idUsuario}::uuid,
            p_payment_method   => ${d.metodoPago},
            p_coupon_code      => ${d.cupon ?? null}
          )
      `);

      const fila = resultado.rows[0];
      if (!fila) throw new Error("create_pending_order no devolvió pedido");

      // --- 2. Datos del regalo -------------------------------------------
      // `create_pending_order` no los recibe. Se podría haber extendido su
      // firma, pero es la función que sostiene el anti-sobreventa y tocarla
      // por campos que no intervienen en el cálculo añade riesgo sin motivo.
      // Va en la MISMA transacción: o queda el pedido completo, o no queda.
      //
      // Si la tienda no pide destinatario aparte (checkout.destinatarioDistinto
      // en false), el esquema deja destinatarioNombre/Telefono opcionales y el
      // destinatario es el propio comprador.
      await tx.execute(sql`
        update public.orders
           set customer_name   = ${d.compradorNombre},
               phone           = ${d.compradorTelefono},
               recipient_name  = ${d.destinatarioNombre ?? d.compradorNombre},
               recipient_phone = ${d.destinatarioTelefono ?? d.compradorTelefono},
               gift_message    = ${TIENDA.checkout.mensajeRegalo ? d.mensajeTarjeta?.trim() || null : null},
               delivery_date   = ${d.fechaEntrega}::date,
               delivery_slot   = ${d.franja},
               notes           = ${d.indicaciones?.trim() || null}
         where id = ${fila.order_id}
      `);

      return fila;
    });

    // El pedido quedó creado: se ROTA el token de checkout. La cookie existe
    // para el reintento del MISMO intento (doble clic, respuesta perdida);
    // dejarla viva tras el éxito hacía que la SIGUIENTE compra del mismo
    // navegador (<30 min) cayera en la rama de reintento de
    // create_pending_order y CANCELARA el pedido anterior en silencio
    // (verificado con dos pedidos seguidos del mismo navegador). Y si el
    // anterior ya estaba pagado, la función lanzaba RCA03 y el cliente no
    // podía volver a comprar en media hora. Borrarla aquí no rompe el
    // reintento real: si la respuesta se pierde en la red, este Set-Cookie
    // se pierde con ella y el navegador conserva el token viejo.
    tarro.delete(COOKIE_TOKEN);

    // --- 3. Pago -----------------------------------------------------------
    // contra-entrega: no hay nada que cobrar en línea, se confirma y listo.
    // El total va FIRMADO para que la página de gracias pueda mostrarlo sin
    // consultar la base (los números de pedido son enumerables). Ver
    // lib/pagos/recibo.ts.
    const recibo = {
      numeroPedido: pedido.order_number,
      totalCop: pedido.total_cop,
      firma: firmarRecibo(pedido.order_number, pedido.total_cop),
    };

    // El pago por pasarela va a un checkout hospedado. El pedido YA está creado
    // y con su stock reservado: si abrir la pasarela falla (llaves a medio
    // poner, MP caído), se devuelve el número para que el cliente no lo pierda y
    // operaciones cobra por otro medio. Nunca se le dice "pagaste" sin cobro.
    const urlPago = await abrirPasarela(
      d.metodoPago,
      pedido.order_id,
      pedido.order_number,
      pedido.total_cop,
    );

    // Avisos por correo. Al comprador ("recibimos tu orden", con botón de pago
    // si es pasarela) y a la tienda (operaciones + copia). No bloquean ni
    // tumban la compra: las funciones nunca lanzan.
    await Promise.all([
      enviarOrdenRecibida(pedido.order_number, urlPago),
      enviarAvisoTienda(pedido.order_number),
      // Ya compró: se cierra su carrito abandonado para no mandarle después un
      // "¿se te quedó algo?" de lo que acaba de pedir.
      marcarRecuperado(d.compradorCorreo).catch(() => {}),
    ]);

    if (!urlPago) {
      return NextResponse.json({
        ...recibo,
        avisoPago: "No pudimos abrir la pasarela. Guardamos tu pedido; te escribimos para el pago.",
      });
    }

    return NextResponse.json({ ...recibo, urlPago });
  } catch (e) {
    const pg = errorPg(e);
    const conocido = pg?.code ? MENSAJES_CONOCIDOS[pg.code] : undefined;

    if (conocido) {
      // Condición de negocio esperada (sin stock, cupón vencido): se registra
      // SOLO el código, nunca el mensaje —que trae los parámetros de la SQL— y
      // se le dice al comprador qué pasó.
      console.warn(`checkout: ${pg?.code}`);
      return NextResponse.json({ error: conocido.texto }, { status: conocido.status });
    }

    // Inesperado. Se registra el código de Postgres, no el objeto entero: su
    // `message` lleva la sentencia con nombre, correo, teléfono y dirección.
    console.error(`checkout: fallo inesperado (code=${pg?.code ?? "?"})`);
    return NextResponse.json(
      { error: "No pudimos crear el pedido. Contáctanos y lo resolvemos." },
      { status: 500 },
    );
  }
}
