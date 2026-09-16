import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Utilidades para las pruebas contra Postgres.
 *
 * Se prueba contra la base de VERDAD, no contra un doble. Todo lo que sostiene
 * el dinero de esta tienda vive en plpgsql: el anti-sobreventa ES el
 * `SELECT ... FOR UPDATE` ordenado, y la idempotencia ES el índice único. Un
 * simulacro no probaría nada de eso.
 *
 * Cada prueba crea su propio producto con un slug único y lo borra al final,
 * así no depende del catálogo ni lo ensucia.
 */

export type Semilla = {
  productoId: string;
  varianteId: string;
  limpiar: () => Promise<void>;
};

/**
 * Crea un producto de prueba con una variante y el stock que se le pida.
 *
 * Cada llamada crea TAMBIÉN su propia categoría (`zz-prueba-cat-<sufijo>`),
 * en vez de tomar prestada la primera que encuentre en `categories`. Las
 * categorías iniciales ya no las crea una migración SQL: las siembra
 * `lib/db/seed.ts` desde `TIENDA.catalogo.categoriasIniciales`, así que una
 * base recién migrada (sin `pnpm db:seed` todavía) puede no tener ninguna.
 * Con categoría propia, las pruebas de integración no dependen de ese orden.
 */
export async function sembrarProducto(etiqueta: string, stock: number): Promise<Semilla> {
  const sufijo = `${Date.now()}-${Math.floor(performance.now() * 1000) % 100000}`;
  const slug = `zz-prueba-${etiqueta}-${sufijo}`;
  const categoriaSlug = `zz-prueba-cat-${sufijo}`;

  const { rows } = await db.execute<{ producto: string; variante: string; categoria: string }>(sql`
    with categoria as (
      insert into public.categories (slug, name)
      values (${categoriaSlug}, ${`Categoría de prueba ${etiqueta}`})
      returning id
    ),
    p as (
      insert into public.products (slug, name, status, category_id)
      select ${slug}, ${`Prueba ${etiqueta}`}, 'activo', categoria.id from categoria
      returning id
    ),
    v as (
      insert into public.product_variants (product_id, name, price_cop, stock, is_active, position)
      select p.id, 'Único', 100000, ${stock}, true, 0 from p
      returning id, product_id
    )
    select v.product_id as producto, v.id as variante, categoria.id as categoria from v, categoria
  `);

  const fila = rows[0];

  return {
    productoId: fila.producto,
    varianteId: fila.variante,
    async limpiar() {
      /**
       * Borrar los PEDIDOS arrastra en cascada sus líneas y sus reservas
       * (`order_items` e `inventory_reservations` tienen ON DELETE CASCADE
       * desde `orders`), así que solo hay que ocuparse de lo que no cuelga de
       * ahí: los cobros y los eventos de pago.
       *
       * `payment_events` no se ata al pedido —su identidad es
       * (gateway, external_id)—, así que se limpia por el patrón de external_id
       * que usan las pruebas, que siempre lleva dentro el número de pedido.
       */
      const numeros = await db.execute<{ order_number: string }>(sql`
        select o.order_number
          from public.orders o
         where o.id in (
           select order_id from public.order_items where product_id = ${fila.producto}
         )
      `);

      for (const { order_number } of numeros.rows) {
        await db.execute(sql`
          delete from public.payment_events where external_id like ${"%" + order_number + "%"}
        `);
      }

      await db.execute(sql`
        delete from public.payments where order_id in (
          select order_id from public.order_items where product_id = ${fila.producto}
        )
      `);
      await db.execute(sql`
        delete from public.orders where id in (
          select order_id from public.order_items where product_id = ${fila.producto}
        )
      `);
      await db.execute(sql`delete from public.product_variants where product_id = ${fila.producto}`);
      await db.execute(sql`delete from public.products where id = ${fila.producto}`);
      // El producto ya no existe, así que nada más referencia esta categoría
      // propia de la prueba.
      await db.execute(sql`delete from public.categories where id = ${fila.categoria}`);
    },
  };
}

type Pedido = { order_id: string; order_number: string; total_cop: number };

/**
 * Crea un pedido pendiente por el camino real: `create_pending_order`.
 *
 * Fuerza `p_payment_method => 'contra-entrega'`: es el único método que no
 * depende de una pasarela externa (Wompi/Mercado Pago) ni de sus llaves, así
 * que el pedido se crea igual en CI y en local sin configurar nada más. El
 * cobro en sí se prueba aparte, con `cobrar()` y `fulfill_paid_order`.
 */
export async function crearPedido(opciones: {
  productoId: string;
  varianteId?: string | null;
  cantidad: number;
  token: string;
  correo?: string;
  cupon?: string | null;
}): Promise<Pedido> {
  const items = JSON.stringify([
    {
      product_id: opciones.productoId,
      variant_id: opciones.varianteId ?? null,
      quantity: opciones.cantidad,
    },
  ]);

  const { rows } = await db.execute<Pedido>(sql`
    select order_id, order_number, total_cop
      from public.create_pending_order(
        p_email            => ${opciones.correo ?? "prueba@example.com"},
        p_items            => ${items}::jsonb,
        p_shipping_address => ${JSON.stringify({ ciudad: "Ciudad de prueba", line1: "Calle 1" })}::jsonb,
        p_session_token    => ${opciones.token},
        p_user_id          => null,
        p_payment_method   => 'contra-entrega',
        p_coupon_code      => ${opciones.cupon ?? null}
      )
  `);

  return rows[0];
}

type Cobro = {
  order_id: string;
  new_status: string;
  already_processed: boolean;
  needs_review: boolean;
  review_reason: string | null;
};

/** Aplica un cobro por el camino real: `fulfill_paid_order`. */
export async function cobrar(opciones: {
  evento: string;
  transaccion: string;
  referencia: string;
  estado: "aprobado" | "rechazado" | "reembolsado" | "pendiente";
  montoCop: number;
  pasarela?: string;
}): Promise<Cobro> {
  const { rows } = await db.execute<Cobro>(sql`
    select * from public.fulfill_paid_order(
      ${opciones.pasarela ?? "manual"}::payment_gateway,
      ${opciones.evento}::text,
      ${opciones.transaccion}::text,
      ${opciones.referencia}::text,
      ${opciones.estado}::payment_status,
      ${opciones.montoCop}::integer,
      '{}'::jsonb,
      'prueba'::text
    )
  `);
  return rows[0];
}

/** Stock actual de una variante, leído directo de la tabla. */
export async function stockDe(varianteId: string): Promise<number> {
  const { rows } = await db.execute<{ stock: number }>(sql`
    select stock from public.product_variants where id = ${varianteId}
  `);
  return rows[0]?.stock ?? -1;
}

/** Estado actual de un pedido. */
export async function estadoDe(numeroPedido: string): Promise<string> {
  const { rows } = await db.execute<{ status: string }>(sql`
    select status from public.orders where order_number = ${numeroPedido}
  `);
  return rows[0]?.status ?? "inexistente";
}

/**
 * Red de seguridad: barre CUALQUIER producto de prueba que haya quedado suelto.
 *
 * `limpiar()` cubre el caso normal, pero si una prueba revienta a mitad —o si
 * la propia limpieza falla, que ya pasó una vez— los residuos se acumulan en la
 * base de desarrollo y contaminan el catálogo. Esto corre al final de cada
 * archivo y no deja rastro pase lo que pase.
 *
 * Solo toca lo que empieza por `zz-prueba-`, que ningún producto real usa.
 */
export async function barrerRestos(): Promise<void> {
  await db.execute(sql`
    delete from public.payments where order_id in (
      select oi.order_id from public.order_items oi
        join public.products p on p.id = oi.product_id
       where p.slug like 'zz-prueba-%'
    )
  `);
  await db.execute(sql`
    delete from public.orders where id in (
      select oi.order_id from public.order_items oi
        join public.products p on p.id = oi.product_id
       where p.slug like 'zz-prueba-%'
    )
  `);
  await db.execute(sql`
    delete from public.product_variants
     where product_id in (select id from public.products where slug like 'zz-prueba-%')
  `);
  await db.execute(sql`delete from public.products where slug like 'zz-prueba-%'`);
  // Categorías propias de sembrarProducto que hayan quedado sin producto.
  await db.execute(sql`delete from public.categories where slug like 'zz-prueba-cat-%'`);

  // Los eventos huérfanos: los que dejaron las pruebas y ya no tienen cobro.
  await db.execute(sql`
    delete from public.payment_events e
     where e.event_type = 'prueba'
       and not exists (
         select 1 from public.payments p where p.external_id = e.external_id
       )
  `);
}
