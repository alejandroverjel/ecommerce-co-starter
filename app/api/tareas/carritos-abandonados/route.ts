import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";

import { enviarCarritoAbandonado } from "@/lib/correo/carrito";
import { hayCorreoConfigurado } from "@/lib/correo/enviar";
import { tomarCarritosParaAvisar } from "@/lib/data/carrito-abandonado";

/**
 * Barrido de carritos abandonados. Lo dispara un timer de systemd en el VPS:
 *
 *   curl -fsS -X POST https://…/api/tareas/carritos-abandonados/ \
 *        -H "authorization: Bearer $CRON_SECRET"
 *
 * Se puede correr cada hora sin miedo: `tomarCarritosParaAvisar` marca las
 * filas en el mismo UPDATE que las selecciona, así que una segunda corrida no
 * vuelve a escribirle a nadie.
 *
 * SIN CRON_SECRET NO ATIENDE. Es un endpoint que manda correos: dejarlo abierto
 * sería regalar un disparador de spam con el dominio de la tienda.
 */

export const dynamic = "force-dynamic";

/** Comparación de tiempo constante, para no filtrar el secreto por latencia. */
function coincide(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

async function autorizado(): Promise<boolean> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;
  const cabecera = (await headers()).get("authorization") ?? "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  return Boolean(token) && coincide(token, secreto);
}

export async function POST() {
  if (!(await autorizado())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!hayCorreoConfigurado()) {
    // Sin Resend no se toma ninguna fila: marcarlas como avisadas sin haber
    // enviado nada dejaría a esa gente sin recordatorio para siempre.
    return NextResponse.json(
      { error: "correo no configurado", enviados: 0 },
      { status: 503 },
    );
  }

  const carritos = await tomarCarritosParaAvisar();

  // En serie y no en paralelo: son pocos por corrida y a Resend no le sienta
  // bien una ráfaga; además así un fallo no arrastra a los demás.
  let enviados = 0;
  for (const c of carritos) {
    const ok = await enviarCarritoAbandonado(c);
    if (ok) enviados += 1;
  }

  if (carritos.length > 0) {
    console.info(
      `carritos-abandonados: ${enviados}/${carritos.length} recordatorios enviados`,
    );
  }

  return NextResponse.json({ tomados: carritos.length, enviados });
}
