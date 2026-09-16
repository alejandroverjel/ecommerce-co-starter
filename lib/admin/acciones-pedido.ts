"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { enviarAvisoEntrega, enviarConfirmacionDePago } from "@/lib/correo/pedido";
import { orders, payments, ESTADOS_CONSUMEN_STOCK } from "@/lib/db/schema";
import { ejecutar, exigirPersonal, type ResultadoAccion } from "@/lib/admin/guardia";
import {
  ESTADOS_PEDIDO,
  VALORES_MEDIO,
  buscarTransicion,
  etiquetaMedio,
} from "@/lib/admin/estados-pedido";
import { MUNICIPIOS, VALORES_FRANJA_DB } from "@/lib/validaciones/pedido";
import type { ShippingAddressSnapshot } from "@/lib/db/schema";
import { ETIQUETAS_ESTADO } from "@/lib/data/pedidos";
import { leerImporte } from "@/lib/dinero";
import { formatearCOP } from "@/lib/formato";
import { TIENDA } from "@/tienda.config";

/**
 * Acciones de pedido del panel.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA QUE ORDENA ESTE ARCHIVO
 *
 *   Lo que solo mueve la ETIQUETA del pedido se resuelve con un UPDATE.
 *   Lo que mueve DINERO pasa por `fulfill_paid_order`.
 *
 * Esa función es la única que sabe hacer bien las cuatro cosas difíciles:
 * escribir en `payments` sin duplicar, descontar inventario exactamente una vez
 * (marca `stock_descontado_at`), soltar las reservas y dejar el rastro en
 * `payment_events`. Reimplementar cualquiera de esas aquí sería tener dos
 * contratos distintos para el mismo hecho, que es lo que ya rompió esta base
 * una vez (ver la cabecera de 0004_pagos.sql).
 *
 * Por eso el inventario NUNCA se toca desde este archivo. No hay un solo
 * `update product_variants` y no debe haberlo: un cambio de estado manual que
 * descontara stock lo estaría bajando por segunda vez.
 * ---------------------------------------------------------------------------
 *
 * AUTORIZACIÓN: cada acción llama a `exigirPersonal()`, que relee el rol de la
 * BASE. La comprobación del layout de /admin no sirve aquí — una server action
 * es un endpoint POST y se puede invocar sin pasar nunca por esa página.
 */

/** Estados cuyo CHECK `orders_paid_at_ck` exige `paid_at` no nulo. */
const EXIGEN_PAID_AT: readonly string[] = ESTADOS_CONSUMEN_STOCK;

/** Lo que devuelve `fulfill_paid_order`. */
type FilaCobro = {
  order_id: string;
  new_status: string;
  already_processed: boolean;
  needs_review: boolean;
  review_reason: string | null;
};

function nombre(estado: string): string {
  return ETIQUETAS_ESTADO[estado] ?? estado;
}

/**
 * Refresca todo lo que lee este pedido.
 *
 * Las páginas del panel son `force-dynamic`, pero el pedido también se ve
 * desde "mi cuenta", y `revalidatePath` es lo único que las despega si mañana
 * alguna deja de serlo. Cuesta nada y evita el bug de "lo cambié y no se ve".
 */
function refrescar(pedidoId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${pedidoId}`);
  revalidatePath("/admin/entregas");
  revalidatePath("/mi-cuenta");
}

const esquemaCambio = z.object({
  pedidoId: z.string().uuid("Pedido inválido"),
  destino: z.enum(ESTADOS_PEDIDO, { message: "Estado inválido" }),
});

/**
 * Mueve el pedido de un estado a otro.
 *
 * Solo acepta transiciones que existen en la máquina. La comprobación se hace
 * aquí y no en el cliente: que el botón no se pinte no impide mandar el POST.
 */
export async function cambiarEstadoPedido(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("cambiar-estado-pedido", async () => {
    const actor = await exigirPersonal();

    const analisis = esquemaCambio.safeParse({
      pedidoId: datos.get("pedidoId"),
      destino: datos.get("destino"),
    });

    if (!analisis.success) {
      return { ok: false, error: "No entendimos qué cambiar. Recarga la página." };
    }

    const { pedidoId, destino } = analisis.data;

    const resultado = await db.transaction(async (tx) => {
      // `for update` desde el principio: dos personas marcando el mismo pedido
      // a la vez es rutina en una mañana de trabajo. La segunda espera y
      // encuentra el estado ya cambiado, en vez de pisarlo.
      //
      // ORDEN DE BLOQUEO: `fulfill_paid_order` toma payment_events ANTES que
      // orders, y aquí se toma orders primero. La inversión no puede provocar
      // un abrazo mortal porque las dos partes nunca compiten por la MISMA
      // fila de payment_events: los eventos que nacen del panel llevan un
      // identificador propio ("manual:", "reembolso-manual:") que ninguna
      // pasarela puede emitir. Si algún día se registra un evento del panel
      // con el id de la pasarela, esto deja de ser cierto.
      const [pedido] = await tx
        .select({
          id: orders.id,
          numero: orders.orderNumber,
          estado: orders.status,
          token: orders.checkoutSessionToken,
        })
        .from(orders)
        .where(eq(orders.id, pedidoId))
        .for("update")
        .limit(1);

      if (!pedido) return { ok: false as const, error: "Ese pedido ya no existe." };

      const transicion = buscarTransicion(pedido.estado, destino);
      if (!transicion) {
        return {
          ok: false as const,
          error: `Un pedido ${nombre(pedido.estado).toLowerCase()} no puede pasar a ${nombre(destino).toLowerCase()}.`,
        };
      }

      // El cobro a mano tiene su propio formulario: necesita medio y monto, y
      // sin eso el pedido quedaría "pagado" sin que conste por dónde entró.
      if (destino === "pagado" && pedido.estado === "pendiente") {
        return {
          ok: false as const,
          error: "Para marcar un pedido como pagado hay que registrar el cobro.",
        };
      }

      if (destino === "reembolsado") {
        return reembolsar(tx, pedido, actor.id);
      }

      if (destino === "cancelado") {
        // Las unidades reservadas se sueltan ANTES de perder el token: es la
        // única llave que las encuentra.
        if (pedido.token) {
          await tx.execute(sql`select release_reservations(${pedido.token}::text)`);
        }

        await tx
          .update(orders)
          .set({
            status: "cancelado",
            cancelledAt: sql`coalesce(${orders.cancelledAt}, now())`,
            /**
             * El token se LIBERA, no se conserva. Si se queda pegado a un
             * pedido cancelado, `create_pending_order` levanta RCA03 contra
             * ese mismo token para siempre y ese navegador no vuelve a
             * comprar nunca. Es el "token envenenado" documentado en
             * 0001_funciones.sql.
             */
            checkoutSessionToken: null,
          })
          .where(eq(orders.id, pedidoId));

        return {
          ok: true as const,
          mensaje: `Pedido ${pedido.numero} cancelado. Las unidades reservadas quedaron libres.`,
        };
      }

      await tx
        .update(orders)
        .set({
          status: destino,
          /**
           * `orders_paid_at_ck` exige `paid_at` en pagado, en_preparacion,
           * enviado y entregado. Ya debería venir puesto —a esos estados solo
           * se llega tras un cobro— pero un pedido importado del histórico
           * puede no traerlo, y sin este coalesce el UPDATE reventaría con un
           * error de restricción en la cara del operador.
           */
          ...(EXIGEN_PAID_AT.includes(destino)
            ? { paidAt: sql`coalesce(${orders.paidAt}, now())` }
            : {}),
        })
        .where(eq(orders.id, pedidoId));

      // Solo el AVANCE avisa al cliente, no una corrección. Volver de "enviado"
      // a "preparación" es un arreglo interno; mandar "va en camino" y al rato
      // "perdón, todavía no" confunde más de lo que informa. El dato viaja en
      // el resultado para mandar el correo DESPUÉS de comitear la transacción.
      const avisar =
        (destino === "enviado" || destino === "entregado") &&
        transicion.tono === "avance"
          ? { numero: pedido.numero, estado: destino }
          : undefined;

      return {
        ok: true as const,
        mensaje: `Pedido ${pedido.numero}: ${nombre(destino).toLowerCase()}.`,
        avisar,
      };
    });

    if (resultado.ok) {
      refrescar(pedidoId);
      // El correo va fuera de la transacción: se manda solo si el cambio quedó
      // comiteado, y su fallo no revierte el estado (enviarAvisoEntrega no lanza).
      if ("avisar" in resultado && resultado.avisar) {
        await enviarAvisoEntrega(resultado.avisar.numero, resultado.avisar.estado);
      }
    }
    return resultado;
  });
}

/**
 * Reembolso.
 *
 * No se resuelve con `update orders set status = 'reembolsado'`: eso dejaría
 * el cobro en `payments` diciendo "aprobado" para siempre y la contabilidad
 * mostrando una plata que ya se devolvió. Se pasa por `fulfill_paid_order`
 * contra la transacción original, que marca el pago como reembolsado, mueve el
 * pedido y anota el evento.
 *
 * El inventario NO se repone automáticamente: un reembolso no siempre
 * significa producto reutilizable (perecederos, personalizados). Reponerlo se
 * hace a mano desde productos, y a propósito.
 */
async function reembolsar(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  pedido: { id: string; numero: string; estado: string },
  actorId: string,
): Promise<ResultadoAccion> {
  const cobros = await tx
    .select({
      pasarela: payments.gateway,
      externalId: payments.externalId,
      montoCop: payments.amountCop,
    })
    .from(payments)
    .where(and(eq(payments.orderId, pedido.id), eq(payments.status, "aprobado")));

  if (cobros.length === 0) {
    return {
      ok: false,
      error: "Este pedido no tiene ningún cobro registrado, así que no hay qué reembolsar.",
    };
  }

  if (cobros.length > 1) {
    return {
      ok: false,
      error: "Este pedido tiene más de un cobro aprobado. Revísalo antes de reembolsar.",
    };
  }

  const cobro = cobros[0]!;
  if (!cobro.externalId) {
    return {
      ok: false,
      error: "El cobro no tiene identificador de transacción. Hay que revisarlo a mano.",
    };
  }

  // El evento lleva marca de tiempo y la transacción no: misma razón que en el
  // cobro manual. Un reembolso rechazado dejaba marcado el evento y quemaba la
  // única llave, así que el pedido ya no se podía reembolsar desde el panel.
  // La transacción sigue siendo la del cobro original, que es lo que ata el
  // reembolso a su pago.
  const eventoReembolso = `reembolso-manual:${pedido.numero}:${Date.now()}`;

  const { rows } = await tx.execute<FilaCobro>(sql`
    select * from fulfill_paid_order(
      ${cobro.pasarela}::payment_gateway,
      ${eventoReembolso}::text,
      ${cobro.externalId}::text,
      ${pedido.numero}::text,
      'reembolsado'::payment_status,
      ${cobro.montoCop}::integer,
      ${JSON.stringify({
        origen: "panel",
        registradoPor: actorId,
        registradoEn: new Date().toISOString(),
      })}::jsonb,
      'reembolso_manual'::text
    )`);

  const fila = rows[0];
  if (!fila) return { ok: false, error: "La base no confirmó el reembolso." };

  if (fila.already_processed) {
    return { ok: false, error: "Este pedido ya tenía un reembolso registrado." };
  }

  if (fila.new_status !== "reembolsado") {
    return {
      ok: false,
      error: fila.review_reason ?? "El reembolso no se pudo aplicar. Revísalo.",
    };
  }

  return {
    ok: true,
    mensaje: fila.needs_review
      ? `Pedido ${pedido.numero} reembolsado. REVISAR: ${fila.review_reason}`
      : `Pedido ${pedido.numero} reembolsado.`,
  };
}

/**
 * Editar la etiqueta logística del pedido: fecha, franja, a quién y a dónde.
 *
 * Es rutina que un cliente llame para correr la fecha o corregir la dirección,
 * y hoy la única vía era psql en el VPS. Esto NO toca dinero ni inventario ni
 * el estado: solo los datos de entrega, así que un UPDATE simple con la guardia
 * de personal basta. La dirección se guarda como snapshot jsonb; se hace merge
 * para no perder departamento/line2 que el formulario no edita.
 */
const esquemaEntrega = z.object({
  pedidoId: z.string().uuid("Pedido inválido"),
  fechaEntrega: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD"),
  // El CHECK de la base, no VALORES_FRANJA: esto edita pedidos ya creados, y
  // uno viejo puede llevar una franja que la tienda ya no ofrece hoy.
  franja: z.enum(VALORES_FRANJA_DB, { message: "Escoge una franja" }),
  destinatario: z.string().trim().min(1, "El nombre de quien recibe es obligatorio").max(120),
  telefonoDestinatario: z
    .string()
    .trim()
    .regex(/^\d{7,15}$/, "El teléfono debe tener solo números (7 a 15 dígitos)"),
  ciudad: z.enum(MUNICIPIOS as unknown as [string, ...string[]], {
    message: "Escoge un municipio con cobertura",
  }),
  direccion: z.string().trim().min(1, "La dirección es obligatoria").max(200),
  indicaciones: z.string().trim().max(300).optional(),
});

export async function editarEntregaPedido(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("editar-entrega-pedido", async () => {
    await exigirPersonal();

    const analisis = esquemaEntrega.safeParse({
      pedidoId: datos.get("pedidoId"),
      fechaEntrega: datos.get("fechaEntrega"),
      franja: datos.get("franja"),
      destinatario: datos.get("destinatario"),
      telefonoDestinatario: datos.get("telefonoDestinatario"),
      ciudad: datos.get("ciudad"),
      direccion: datos.get("direccion"),
      indicaciones: datos.get("indicaciones") || undefined,
    });

    if (!analisis.success) {
      return { ok: false, error: analisis.error.issues[0]?.message ?? "Revisa los datos." };
    }

    const d = analisis.data;

    const [pedido] = await db
      .select({ id: orders.id, numero: orders.orderNumber, direccion: orders.shippingAddress })
      .from(orders)
      .where(eq(orders.id, d.pedidoId))
      .limit(1);

    if (!pedido) return { ok: false, error: "Ese pedido ya no existe." };

    // Merge sobre el snapshot: se conservan departamento y line2, que este
    // formulario no edita.
    const anterior = (pedido.direccion ?? {}) as Partial<ShippingAddressSnapshot>;
    const nuevaDireccion: ShippingAddressSnapshot = {
      recipientName: d.destinatario,
      recipientPhone: d.telefonoDestinatario,
      departamento: anterior.departamento ?? TIENDA.ubicacion.departamento,
      ciudad: d.ciudad,
      line1: d.direccion,
      line2: anterior.line2 ?? null,
      notes: d.indicaciones ?? null,
    };

    await db
      .update(orders)
      .set({
        deliveryDate: d.fechaEntrega,
        deliverySlot: d.franja,
        recipientName: d.destinatario,
        recipientPhone: d.telefonoDestinatario,
        notes: d.indicaciones ?? null,
        shippingAddress: nuevaDireccion,
      })
      .where(eq(orders.id, d.pedidoId));

    refrescar(d.pedidoId);
    return { ok: true, mensaje: `Datos de entrega de ${pedido.numero} actualizados.` };
  });
}

const esquemaCobro = z.object({
  pedidoId: z.string().uuid("Pedido inválido"),
  medio: z.enum(VALORES_MEDIO, { message: "Escoge por dónde entró la plata" }),
  monto: z.string().min(1, "Escribe cuánto se cobró"),
  referencia: z.string().trim().max(80, "Demasiado largo").optional(),
  nota: z.string().trim().max(300, "Demasiado largo").optional(),
  /**
   * Casilla que solo hay que marcar cuando el monto NO coincide con el total.
   *
   * Sin esto, un cero de menos —6.000 donde iban 60.000— se aceptaba con una
   * nota de "REVISAR" y el pedido quedaba pagado, con el stock descontado y la
   * fila de payments congelada en la cifra equivocada. `fulfill_paid_order`
   * avisa del descuadre pero no lo bloquea, a propósito: la plata pudo haberse
   * movido de verdad. Quien tiene que decidir si fue un dedazo es la persona.
   */
  confirmarDescuadre: z.coerce.boolean().optional(),
});

/**
 * Registra un cobro que no pasó por ninguna pasarela y deja el pedido pagado.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE ESCRIBE UNA FILA EN `payments` Y NO SOLO `orders.paid_at`
 *
 * Porque si no, la contabilidad queda coja de una forma que no avisa: la suma
 * de `payments` sería menor que la suma de los pedidos pagados y nadie podría
 * decir cuánta plata entró en efectivo, ni por qué cuenta, ni quién la
 * recibió. Además rompería el invariante que `fulfill_paid_order` defiende —
 * "ningún pedido pasa a pagado sin una fila de cobro aprobada suya"— que es
 * justo la red que atrapa los pedidos despachados sin cobrar.
 *
 * La fila lleva `gateway = 'manual'` (valor propio del enum, ver
 * 0005_pago_manual.sql), el medio real —efectivo, transferencia, Nequi—, quién
 * lo registró y cuándo, dentro de `raw_response`. Con eso se concilia contra la
 * caja y contra el extracto del banco, y se puede separar de los cobros de
 * pasarela con un `where gateway = 'manual'`.
 *
 * POR QUÉ A TRAVÉS DE `fulfill_paid_order` Y NO CON UN INSERT DIRECTO
 *
 * Un insert directo tendría que reimplementar: la idempotencia por
 * (gateway, external_id), el descuento de inventario exactamente una vez con
 * `stock_descontado_at`, el borrado de las reservas del token y el rastro del
 * evento. Son las cuatro cosas que esta base ya reescribió tres veces hasta
 * dejarlas bien. Se llama a la función; no se copia.
 *
 * Ese descuento de inventario NO contradice la regla de "no tocar el stock":
 * lo hace la misma función que lo hace con Wompi, con la misma marca que
 * garantiza que sea una sola vez. Lo prohibido es descontarlo desde aquí.
 * ---------------------------------------------------------------------------
 */
export async function registrarPagoManual(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("registrar-pago-manual", async () => {
    const actor = await exigirPersonal();

    const analisis = esquemaCobro.safeParse({
      pedidoId: datos.get("pedidoId"),
      medio: datos.get("medio"),
      monto: datos.get("monto"),
      confirmarDescuadre: datos.get("confirmarDescuadre") === "on",
      referencia: datos.get("referencia") || undefined,
      nota: datos.get("nota") || undefined,
    });

    if (!analisis.success) {
      return {
        ok: false,
        error: analisis.error.issues[0]?.message ?? "Revisa los datos del cobro.",
      };
    }

    const { pedidoId, medio, monto, referencia, nota, confirmarDescuadre } =
      analisis.data;

    // El monto lo escribe una persona a las carreras: "60.000" son sesenta mil
    // pesos, no sesenta con decimales.
    const lectura = leerImporte(monto);
    if (!lectura.ok) return { ok: false, error: lectura.error };

    /**
     * UN COBRO DE CERO NO ES UN COBRO, Y ADEMÁS INUTILIZA EL PEDIDO.
     *
     * `leerImporte("0")` devuelve un 0 válido —el stock puede ser 0, un cobro
     * no—. Con 0, `fulfill_paid_order` rechaza el pago en su guarda 5.b y no
     * inserta nada en `payments`, pero SÍ marca el evento como procesado. Como
     * la llave del evento es determinista (`manual:ORD-xxxx`), el siguiente
     * intento con el monto correcto entra por la rama de idempotencia,
     * responde "ya procesado" y no hace nada.
     *
     * Resultado: el pedido queda sin poder cobrarse nunca desde el panel.
     */
    if (lectura.pesos <= 0) {
      return {
        ok: false,
        error: "El cobro tiene que ser mayor que cero. Si no se cobró nada, no lo registres.",
      };
    }

    const resultado = await db.transaction(async (tx) => {
      const [pedido] = await tx
        .select({
          id: orders.id,
          numero: orders.orderNumber,
          estado: orders.status,
          totalCop: orders.totalCop,
        })
        .from(orders)
        .where(eq(orders.id, pedidoId))
        .for("update")
        .limit(1);

      if (!pedido) return { ok: false as const, error: "Ese pedido ya no existe." };

      // El bloqueo de arriba convierte el doble clic en un rechazo limpio: la
      // segunda transacción espera, encuentra el pedido ya pagado y para.
      if (pedido.estado !== "pendiente") {
        return {
          ok: false as const,
          error: `Este pedido está ${nombre(pedido.estado).toLowerCase()}. Solo se puede registrar un cobro sobre uno pendiente.`,
        };
      }

      // Descuadre sin confirmar: casi siempre es un cero de más o de menos.
      // Se para ANTES de llamar a la función, porque una vez registrado el
      // monto queda congelado y corregirlo exige tocar la base a mano.
      if (lectura.pesos !== pedido.totalCop && !confirmarDescuadre) {
        const diferencia = lectura.pesos - pedido.totalCop;
        return {
          ok: false as const,
          error:
            `El pedido vale ${formatearCOP(pedido.totalCop)} y escribiste ` +
            `${formatearCOP(lectura.pesos)} (${diferencia > 0 ? "sobran" : "faltan"} ` +
            `${formatearCOP(Math.abs(diferencia))}). Si es correcto, marca la casilla de descuadre.`,
        };
      }

      /**
       * DOS IDENTIFICADORES DISTINTOS, PORQUE PROTEGEN COSAS DISTINTAS.
       *
       * La TRANSACCIÓN es determinista (`manual:ORD-xxxx`): el índice único
       * (gateway, external_id) de `payments` es lo que de verdad impide cobrar
       * dos veces el mismo pedido. Eso no cambia.
       *
       * El EVENTO lleva además una marca de tiempo, y eso sí es nuevo. Antes
       * ambos compartían el mismo valor, y ahí estaba el problema: cuando
       * `fulfill_paid_order` se niega a aplicar un cobro —monto que no cuadra,
       * pedido ya pagado por otra vía— igualmente deja el EVENTO marcado como
       * procesado. Con un id determinista, esa marca quemaba la única llave del
       * pedido: el siguiente intento, ya con los datos correctos, entraba por
       * la rama de idempotencia, respondía "ya tenía un cobro registrado" y no
       * hacía nada. El pedido quedaba sin poder cobrarse desde el panel, solo
       * a mano en psql.
       *
       * Cada intento es un evento distinto; el dinero sigue siendo el mismo.
       * Dos clics seguidos del botón crean dos eventos, pero el segundo choca
       * con el índice único de la transacción y no duplica el cobro, y
       * `stock_descontado_at` impide que el inventario se descuente dos veces.
       */
      const transaccionManual = `manual:${pedido.numero}`;
      const eventoManual = `${transaccionManual}:${Date.now()}`;

      const { rows } = await tx.execute<FilaCobro>(sql`
        select * from fulfill_paid_order(
          'manual'::payment_gateway,
          ${eventoManual}::text,
          ${transaccionManual}::text,
          ${pedido.numero}::text,
          'aprobado'::payment_status,
          ${lectura.pesos}::integer,
          ${JSON.stringify({
            origen: "panel",
            medio,
            medioEtiqueta: etiquetaMedio(medio),
            referencia: referencia ?? null,
            nota: nota ?? null,
            registradoPor: actor.id,
            registradoEn: new Date().toISOString(),
          })}::jsonb,
          'pago_manual'::text
        )`);

      const fila = rows[0];
      if (!fila) return { ok: false as const, error: "La base no confirmó el cobro." };

      if (fila.already_processed) {
        return { ok: false as const, error: "Este pedido ya tenía un cobro registrado." };
      }

      /**
       * Se DEVUELVE el error pero NO se revierte la transacción, y eso es
       * deliberado: cuando `fulfill_paid_order` se niega a mover el pedido
       * igual deja escrito el cobro y el evento, porque la plata existe. Un
       * `throw` aquí borraría ese registro y dejaría dinero recibido sin
       * ninguna huella, que es peor que un pedido con el estado desfasado.
       */
      if (fila.new_status !== "pagado") {
        return {
          ok: false as const,
          error: fila.review_reason ?? "El cobro se registró pero el pedido no quedó pagado.",
        };
      }

      // `needs_review` no es un fallo: el cobro quedó escrito. Pero el motivo
      // más común aquí es un descuadre de monto, y eso hay que verlo.
      return {
        ok: true as const,
        // El número viaja fuera de la transacción para poder mandar el correo
        // de confirmación una vez comiteada.
        numeroPedido: pedido.numero,
        mensaje: fila.needs_review
          ? `Cobro registrado. REVISAR: ${fila.review_reason}`
          : `Pedido ${pedido.numero} pagado por ${etiquetaMedio(medio).toLowerCase()}.`,
      };
    });

    if (resultado.ok) {
      refrescar(pedidoId);
      // El cobro descontó inventario: las fichas de producto se cachean una
      // hora y mostrarían stock viejo.
      revalidatePath("/tienda/[categoria]/[producto]", "page");

      // Mismo aviso que manda el webhook de una pasarela: para el comprador,
      // que le cobren en efectivo no es distinto de pagar con tarjeta.
      await enviarConfirmacionDePago(resultado.numeroPedido);
    }

    return resultado;
  });
}
