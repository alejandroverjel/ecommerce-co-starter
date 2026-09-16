import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Healthcheck del contenedor.
 *
 * El docker-compose apunta su healthcheck aquí. La ruta NO existía: el
 * contenedor quedaba `unhealthy` para siempre y cualquier `depends_on:
 * condition: service_healthy` nunca se cumplía.
 *
 * Hace un `select 1` con tiempo acotado: si la base no responde, la app no
 * puede aceptar pedidos y vale la pena marcar el contenedor caído. No consulta
 * nada pesado a propósito, para no marcar caída la tienda por un pico de carga.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
