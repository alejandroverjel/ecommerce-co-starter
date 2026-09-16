import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { abandonedCarts } from "@/lib/db/schema";

/**
 * Carritos abandonados: guardar, marcar recuperados y elegir a quién escribir.
 *
 * La regla de negocio de cuándo se escribe vive aquí, no en el endpoint, para
 * que el barrido y el admin vean exactamente el mismo criterio.
 */

/**
 * Línea del carrito tal como se congela.
 *
 * Se guarda la línea COMPLETA (ids incluidos), no solo lo que se pinta en el
 * correo: el enlace de recuperación tiene que poder rearmar el carrito en otro
 * dispositivo, y el correo se abre en el móvil la mitad de las veces. Con solo
 * nombre y precio, ese enlace no podría reconstruir nada.
 */
export type LineaGuardada = {
  productoId: string;
  varianteId: string | null;
  slug: string;
  nombre: string;
  precioCop: number;
  imagenUrl: string | null;
  ruta: string;
  cantidad: number;
};

/**
 * Ventana de envío.
 *
 * Antes de 4 h la persona muchas veces sigue comprando en otra pestaña, y el
 * correo llega como un empujón impertinente. Después de 48 h el recordatorio ya
 * no recupera nada y se lee como spam. Se manda UNO solo, dentro de ese rango.
 */
export const HORAS_MINIMAS = 4;
export const HORAS_MAXIMAS = 48;

/**
 * Guarda (o actualiza) el carrito de un correo.
 *
 * Upsert por correo: mientras la persona edita el checkout se sobreescribe la
 * misma fila. `updated_at` se mueve en cada cambio, y de ahí sale la antigüedad
 * que mira el barrido — así los 4 h cuentan desde la ÚLTIMA señal de vida, no
 * desde la primera.
 *
 * No se toca una fila ya recuperada ni una dada de baja: quien ya compró o pidió
 * no recibir correos no vuelve a entrar en la cola por seguir navegando.
 */
export async function guardarCarritoAbandonado(datos: {
  email: string;
  items: LineaGuardada[];
  subtotalCop: number;
  consent: boolean;
}): Promise<void> {
  const email = datos.email.trim().toLowerCase();

  await db
    .insert(abandonedCarts)
    .values({
      email,
      items: datos.items,
      subtotalCop: datos.subtotalCop,
      consent: datos.consent,
    })
    .onConflictDoUpdate({
      target: abandonedCarts.email,
      set: {
        items: datos.items,
        subtotalCop: datos.subtotalCop,
        consent: datos.consent,
        updatedAt: new Date(),
      },
      // Una baja es definitiva; un carrito ya recuperado se reabre solo si la
      // persona vuelve a abandonar (lo hace `marcarRecuperado` al limpiarlo).
      where: isNull(abandonedCarts.unsubscribedAt),
    });
}

/**
 * La persona compró: se cierra su carrito para que no reciba el recordatorio.
 *
 * Se llama desde el checkout con el correo del pedido. Sirve para dos cosas: no
 * escribirle a quien ya compró (el error más caro de estos sistemas) y medir
 * cuántas ventas vinieron del correo.
 */
export async function marcarRecuperado(email: string): Promise<void> {
  await db
    .update(abandonedCarts)
    .set({ recoveredAt: new Date() })
    .where(
      and(
        eq(abandonedCarts.email, email.trim().toLowerCase()),
        isNull(abandonedCarts.recoveredAt),
      ),
    );
}

/** Baja voluntaria desde el enlace del correo. */
export async function darDeBaja(email: string): Promise<void> {
  await db
    .update(abandonedCarts)
    .set({ unsubscribedAt: new Date() })
    .where(eq(abandonedCarts.email, email.trim().toLowerCase()));
}

export type CarritoParaAvisar = {
  id: string;
  email: string;
  items: LineaGuardada[];
  subtotalCop: number;
};

/**
 * Toma los carritos que toca avisar y los marca en el MISMO paso.
 *
 * El `update ... returning` con la marca incluida es lo que hace el barrido
 * seguro de repetir: si el cron se dispara dos veces (reintento, dos réplicas),
 * la segunda corrida no encuentra nada porque la primera ya puso `emailed_at`.
 * Marcar después de mandar el correo dejaría una ventana para escribir dos
 * veces; se prefiere el riesgo contrario —perder un correo si el envío falla—
 * porque molestar dos veces cuesta más que no molestar.
 *
 * `for update skip locked` evita que dos corridas simultáneas se peleen la
 * misma fila.
 */
export async function tomarCarritosParaAvisar(
  limite = 50,
): Promise<CarritoParaAvisar[]> {
  const { rows } = await db.execute<{
    id: string;
    email: string;
    items: LineaGuardada[];
    subtotal_cop: number;
  }>(sql`
    with elegidos as (
      select id
        from public.abandoned_carts
       where emailed_at      is null
         and recovered_at    is null
         and unsubscribed_at is null
         and consent         is true
         and subtotal_cop    > 0
         and updated_at <= now() - make_interval(hours => ${HORAS_MINIMAS})
         and updated_at >= now() - make_interval(hours => ${HORAS_MAXIMAS})
         -- Nunca a quien ya compró con ese correo, aunque nadie lo haya marcado.
         and not exists (
           select 1 from public.orders o
            where lower(o.email) = public.abandoned_carts.email
              and o.created_at >= public.abandoned_carts.updated_at)
       order by updated_at
       limit ${limite}
       for update skip locked
    )
    update public.abandoned_carts a
       set emailed_at = now()
      from elegidos e
     where a.id = e.id
    returning a.id, a.email, a.items, a.subtotal_cop
  `);

  return rows.map((f) => ({
    id: f.id,
    email: f.email,
    items: f.items,
    subtotalCop: f.subtotal_cop,
  }));
}

/** Números para el panel: cuántos se avisaron y cuántos volvieron a comprar. */
export type ResumenCarritos = {
  pendientes: number;
  avisados: number;
  recuperados: number;
};

export async function resumenCarritosAbandonados(): Promise<ResumenCarritos> {
  const { rows } = await db.execute<{
    pendientes: number;
    avisados: number;
    recuperados: number;
  }>(sql`
    select
      count(*) filter (
        where emailed_at is null and recovered_at is null
          and unsubscribed_at is null)::int          as pendientes,
      count(*) filter (where emailed_at   is not null)::int as avisados,
      count(*) filter (where recovered_at is not null)::int as recuperados
    from public.abandoned_carts
  `);

  return {
    pendientes: rows[0]?.pendientes ?? 0,
    avisados: rows[0]?.avisados ?? 0,
    recuperados: rows[0]?.recuperados ?? 0,
  };
}
