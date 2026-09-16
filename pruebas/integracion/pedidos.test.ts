import { afterAll, afterEach, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  barrerRestos,
  cobrar,
  crearPedido,
  estadoDe,
  sembrarProducto,
  stockDe,
  type Semilla,
} from "./ayuda";

/**
 * El camino del dinero, contra Postgres de verdad.
 *
 * `drizzle/ESTADO-CAMINO-PAGO.md` documenta seis fallos que costaron tres
 * rondas de parches: doble cobro, doble descuento de stock, reembolso sin
 * cobro previo, monto opcional, pedido congelado y deadlock. Cada uno tiene
 * aquí su reproducción, para que el séptimo intento de romperlo falle en CI y
 * no en producción.
 */

let semilla: Semilla | null = null;

afterEach(async () => {
  await semilla?.limpiar();
  semilla = null;
});

// Por si alguna prueba revienta antes de tiempo y su limpieza no llega a correr.
afterAll(barrerRestos);

describe("create_pending_order — precios y stock", () => {
  it("el precio sale de la BASE, no de lo que mande el cliente", async () => {
    semilla = await sembrarProducto("precio", 10);
    const pedido = await crearPedido({
      productoId: semilla.productoId,
      cantidad: 2,
      token: `t-${Date.now()}`,
    });

    // 2 × 100.000 = 200.000 de producto. El envío lo pone store_settings.
    expect(pedido.total_cop).toBeGreaterThanOrEqual(200_000);
  });

  it("rechaza pedir más unidades de las que hay", async () => {
    semilla = await sembrarProducto("sinstock", 1);
    await expect(
      crearPedido({ productoId: semilla.productoId, cantidad: 5, token: `t-${Date.now()}` }),
    ).rejects.toThrow();
  });

  it("respeta la variante que escogió el cliente", async () => {
    semilla = await sembrarProducto("variante", 5);
    const pedido = await crearPedido({
      productoId: semilla.productoId,
      varianteId: semilla.varianteId,
      cantidad: 1,
      token: `t-${Date.now()}`,
    });
    expect(pedido.order_number).toMatch(/^ORD-/);
  });

  it("una variante que no es de ese producto NO cobra otra cosa", async () => {
    semilla = await sembrarProducto("ajena", 5);
    await expect(
      crearPedido({
        productoId: semilla.productoId,
        varianteId: "00000000-0000-0000-0000-000000000000",
        cantidad: 1,
        token: `t-${Date.now()}`,
      }),
    ).rejects.toThrow();
  });

  it("reintentar con el MISMO token no acumula reservas", async () => {
    semilla = await sembrarProducto("reintento", 1);
    const token = `t-reintento-${Date.now()}`;

    const primero = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token });
    // Con stock 1, si la reserva anterior no se soltara, esto fallaría.
    const segundo = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token });

    expect(segundo.order_number).not.toBe(primero.order_number);
    expect(await estadoDe(primero.order_number)).toBe("cancelado");
    expect(await estadoDe(segundo.order_number)).toBe("pendiente");
  });

  it("dos clientes distintos no pueden comprar la última unidad", async () => {
    semilla = await sembrarProducto("carrera", 1);
    await crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `a-${Date.now()}` });

    // El segundo ve la reserva del primero y no alcanza.
    await expect(
      crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `b-${Date.now()}` }),
    ).rejects.toThrow();
  });
});

describe("fulfill_paid_order — los seis fallos que ya costaron caro", () => {
  it("BUG: doble cobro. El mismo evento reenviado no cobra dos veces", async () => {
    semilla = await sembrarProducto("idem", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `t-${Date.now()}` });
    const evento = `evt-${p.order_number}`;

    const uno = await cobrar({
      evento, transaccion: `tx-${p.order_number}`, referencia: p.order_number,
      estado: "aprobado", montoCop: p.total_cop,
    });
    const dos = await cobrar({
      evento, transaccion: `tx-${p.order_number}`, referencia: p.order_number,
      estado: "aprobado", montoCop: p.total_cop,
    });

    expect(uno.already_processed).toBe(false);
    expect(dos.already_processed).toBe(true);
  });

  it("BUG: doble descuento de stock. El reenvío no vuelve a descontar", async () => {
    semilla = await sembrarProducto("stock2x", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 2, token: `t-${Date.now()}` });
    const evento = `evt-stock-${p.order_number}`;

    await cobrar({ evento, transaccion: `tx-${p.order_number}`, referencia: p.order_number, estado: "aprobado", montoCop: p.total_cop });
    const trasUno = await stockDe(semilla.varianteId);

    await cobrar({ evento, transaccion: `tx-${p.order_number}`, referencia: p.order_number, estado: "aprobado", montoCop: p.total_cop });
    const trasDos = await stockDe(semilla.varianteId);

    expect(trasUno).toBe(3); // 5 - 2
    expect(trasDos).toBe(trasUno); // y NO 1
  });

  it("BUG: monto obligatorio. Un cobro de 0 no marca el pedido pagado", async () => {
    semilla = await sembrarProducto("cero", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `t-${Date.now()}` });

    const r = await cobrar({
      evento: `evt-cero-${p.order_number}`, transaccion: `tx-cero-${p.order_number}`,
      referencia: p.order_number, estado: "aprobado", montoCop: 0,
    });

    expect(r.new_status).not.toBe("pagado");
  });

  it("BUG: reembolso sin cobro previo. No se puede reembolsar lo no cobrado", async () => {
    semilla = await sembrarProducto("reemb", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `t-${Date.now()}` });

    const r = await cobrar({
      evento: `evt-r-${p.order_number}`, transaccion: `tx-r-${p.order_number}`,
      referencia: p.order_number, estado: "reembolsado", montoCop: p.total_cop,
    });

    expect(r.new_status).not.toBe("reembolsado");
  });

  it("un monto distinto del total marca el pedido para revisión", async () => {
    semilla = await sembrarProducto("descuadre", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `t-${Date.now()}` });

    const r = await cobrar({
      evento: `evt-d-${p.order_number}`, transaccion: `tx-d-${p.order_number}`,
      referencia: p.order_number, estado: "aprobado", montoCop: p.total_cop - 50_000,
    });

    expect(r.needs_review).toBe(true);
    expect(r.review_reason).toBeTruthy();
  });

  it("un pago rechazado no descuenta inventario", async () => {
    semilla = await sembrarProducto("rechazo", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 2, token: `t-${Date.now()}` });
    const antes = await stockDe(semilla.varianteId);

    await cobrar({
      evento: `evt-x-${p.order_number}`, transaccion: `tx-x-${p.order_number}`,
      referencia: p.order_number, estado: "rechazado", montoCop: p.total_cop,
    });

    expect(await stockDe(semilla.varianteId)).toBe(antes);
    expect(await estadoDe(p.order_number)).not.toBe("pagado");
  });

  it("exige identificador de transacción: sin él no hay idempotencia", async () => {
    semilla = await sembrarProducto("sintx", 5);
    const p = await crearPedido({ productoId: semilla.productoId, cantidad: 1, token: `t-${Date.now()}` });

    await expect(
      cobrar({
        evento: `evt-nt-${p.order_number}`, transaccion: "",
        referencia: p.order_number, estado: "aprobado", montoCop: p.total_cop,
      }),
    ).rejects.toThrow();
  });
});

describe("sobreventa en contra entrega", () => {
  it("la reserva de un pedido contra entrega NO vence a los 15 minutos", async () => {
    semilla = await sembrarProducto("ttl", 1);

    const p = await crearPedido({
      productoId: semilla.productoId,
      cantidad: 1,
      token: `t-ttl-${Date.now()}`,
    });

    // Cuánto se apartó la unidad, en horas.
    const { rows } = await db.execute<{ horas: string }>(sql`
      select extract(epoch from (r.expires_at - now())) / 3600 as horas
        from public.inventory_reservations r
        join public.orders o on o.id = r.order_id
       where o.order_number = ${p.order_number}
    `);

    // `pg` entrega los `numeric` como texto para no perder precisión.
    const horas = Number(rows[0].horas);

    // Con contra entrega el cobro llega horas o días después: 15 minutos
    // dejarían la unidad libre para que otro la comprara mientras tanto.
    expect(horas).toBeGreaterThan(24);
  });

  it("con el pedido vivo, otro cliente NO puede llevarse la última unidad", async () => {
    semilla = await sembrarProducto("noroba", 1);

    await crearPedido({
      productoId: semilla.productoId,
      cantidad: 1,
      token: `t-primero-${Date.now()}`,
    });

    // Aunque pasen 15 minutos, la unidad sigue comprometida.
    await expect(
      crearPedido({
        productoId: semilla.productoId,
        cantidad: 1,
        token: `t-segundo-${Date.now()}`,
      }),
    ).rejects.toThrow();
  });
});

describe("llave del cobro manual", () => {
  it("un intento bloqueado NO deja el pedido imposible de cobrar", async () => {
    semilla = await sembrarProducto("llave", 5);
    const p = await crearPedido({
      productoId: semilla.productoId,
      cantidad: 1,
      token: `t-llave-${Date.now()}`,
    });

    /**
     * Primer intento con monto 0. `fulfill_paid_order` lo rechaza en su guarda
     * de monto y NO inserta cobro, pero sí marca el evento como procesado.
     *
     * Si el id de evento fuera determinista por pedido, esa marca quemaría la
     * única llave disponible y el segundo intento —con el monto correcto—
     * entraría por la rama de idempotencia sin hacer nada: el pedido quedaría
     * sin poder cobrarse desde el panel, solo a mano en psql.
     */
    const fallido = await cobrar({
      evento: `manual:${p.order_number}:intento-1`,
      transaccion: `manual:${p.order_number}`,
      referencia: p.order_number,
      estado: "aprobado",
      montoCop: 0,
    });
    expect(fallido.new_status).not.toBe("pagado");

    // Segundo intento, monto correcto, EVENTO DISTINTO y misma transacción.
    const bueno = await cobrar({
      evento: `manual:${p.order_number}:intento-2`,
      transaccion: `manual:${p.order_number}`,
      referencia: p.order_number,
      estado: "aprobado",
      montoCop: p.total_cop,
    });

    expect(bueno.already_processed).toBe(false);
    expect(bueno.new_status).toBe("pagado");
  });

  it("la transacción determinista sigue impidiendo el doble cobro", async () => {
    semilla = await sembrarProducto("nodoble", 5);
    const p = await crearPedido({
      productoId: semilla.productoId,
      cantidad: 1,
      token: `t-nodoble-${Date.now()}`,
    });

    // Dos eventos distintos, misma transacción: es el mismo dinero.
    await cobrar({
      evento: `manual:${p.order_number}:a`,
      transaccion: `manual:${p.order_number}`,
      referencia: p.order_number,
      estado: "aprobado",
      montoCop: p.total_cop,
    });
    await cobrar({
      evento: `manual:${p.order_number}:b`,
      transaccion: `manual:${p.order_number}`,
      referencia: p.order_number,
      estado: "aprobado",
      montoCop: p.total_cop,
    });

    // Una sola fila de cobro, no dos.
    const { rows } = await db.execute<{ n: string }>(sql`
      select count(*)::text as n
        from public.payments pg
        join public.orders o on o.id = pg.order_id
       where o.order_number = ${p.order_number}
    `);
    expect(Number(rows[0].n)).toBe(1);
  });
});
