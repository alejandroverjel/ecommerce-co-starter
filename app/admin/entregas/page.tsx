import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Phone } from "lucide-react";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { SelectorEstado } from "@/components/admin/estado-pedido";
import { BotonCopiarMensaje } from "@/components/admin/tarjeta-pedido";
import { TIENDA } from "@/tienda.config";
import { listarEntregas } from "@/lib/data/admin";
import { exigirPersonalPagina } from "@/lib/admin/pagina";
import { formatearCOP, formatearFechaSola } from "@/lib/formato";
import { etiquetaFranja, hoyEnBogota } from "@/lib/validaciones/pedido";

export const metadata: Metadata = { title: "Entregas" };
export const dynamic = "force-dynamic";

/**
 * La ruta del día.
 *
 * Esta pantalla no existe en el starter. Es la más usada del panel: cada
 * mañana alguien necesita saber qué armar, qué tarjeta escribir a mano y a
 * quién llamar al llegar.
 *
 * Se imprime bien a propósito — en la práctica el mensajero se lleva el papel.
 */
export default async function Entregas({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  await exigirPersonalPagina();
  const { fecha } = await searchParams;

  // Solo se acepta el formato exacto: este valor entra a una consulta como
  // fecha y no debe pasar nada más.
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? "") ? fecha! : hoyEnBogota();
  const esHoy = dia === hoyEnBogota();

  const entregas = await listarEntregas(dia);

  const otroDia = (desplazamiento: number) => {
    const [a, m, d] = dia.split("-").map(Number);
    const f = new Date(a, m - 1, d + desplazamiento);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 print:block">
        <div>
          <h1 className="display text-3xl">
            {esHoy ? "Entregas de hoy" : "Entregas"}
          </h1>
          <p className="mt-1 text-[var(--texto-suave)]">
            {formatearFechaSola(dia)} · {entregas.length}{" "}
            {entregas.length === 1 ? "entrega" : "entregas"}
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Link
            href={`/admin/entregas/?fecha=${otroDia(-1)}`}
            className="rounded-full border bg-[var(--fondo-elevado)] px-4 py-2 text-sm transition-colors hover:bg-[var(--fondo-hondo)]"
          >
            Día anterior
          </Link>
          {!esHoy && (
            <Link
              href="/admin/entregas/"
              className="rounded-full border bg-[var(--fondo-elevado)] px-4 py-2 text-sm transition-colors hover:bg-[var(--fondo-hondo)]"
            >
              Hoy
            </Link>
          )}
          <Link
            href={`/admin/entregas/?fecha=${otroDia(1)}`}
            className="rounded-full border bg-[var(--fondo-elevado)] px-4 py-2 text-sm transition-colors hover:bg-[var(--fondo-hondo)]"
          >
            Día siguiente
          </Link>
        </div>
      </div>

      {entregas.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-12 text-center">
          <p className="display text-xl">Sin entregas este día</p>
          <p className="mt-2 text-sm text-[var(--texto-suave)]">
            Aquí aparecen los pedidos con fecha de entrega asignada, incluidos
            los contra entrega que aún están por cobrar.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {entregas.map((e) => (
            <li
              key={e.id}
              className="rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-6 print:break-inside-avoid"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/admin/pedidos/${e.id}/`}
                    className="cifra text-lg hover:underline print:no-underline"
                  >
                    {e.numero}
                  </Link>
                  {e.franja && (
                    <p className="mt-0.5 text-sm font-medium text-[var(--acento)]">
                      {etiquetaFranja(e.franja)}
                    </p>
                  )}
                </div>
                <EtiquetaEstado estado={e.estado} />
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--texto-tenue)]">
                    Entregar a
                  </h2>
                  <p className="mt-2 font-medium">{e.destinatario ?? "—"}</p>

                  {e.telefonoDestinatario && (
                    <a
                      href={`tel:${e.telefonoDestinatario}`}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--acento)]"
                    >
                      <Phone className="size-3.5" aria-hidden />
                      {e.telefonoDestinatario}
                    </a>
                  )}

                  <p className="mt-2 flex items-start gap-1.5 text-sm text-[var(--texto-suave)]">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      {e.direccion ?? "—"}
                      {e.municipio && <span className="block">{e.municipio}</span>}
                    </span>
                  </p>

                  {e.indicaciones && (
                    <p className="mt-2 text-sm italic text-[var(--texto-tenue)]">
                      {e.indicaciones}
                    </p>
                  )}
                </div>

                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--texto-tenue)]">
                    Qué va
                  </h2>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {e.articulos.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                  <p className="cifra mt-3 text-base">{formatearCOP(e.totalCop)}</p>

                  {/* El recordatorio que evita el hueco en la caja: salió sin
                      cobrar, el domiciliario tiene que volver con la plata. */}
                  {e.estado === "pendiente" && e.metodoPago === "contra-entrega" && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--aviso)]/15 px-3 py-1 text-xs font-semibold text-[var(--aviso)]">
                      Cobrar al entregar: {formatearCOP(e.totalCop)}
                    </p>
                  )}
                </div>
              </div>

              {/* Se destaca porque hay que escribirlo a mano antes de que
                  salga el pedido, y perderlo arruina el mensaje. */}
              {TIENDA.checkout.mensajeRegalo && e.mensajeTarjeta && (
                <div className="mt-5 rounded-lg border bg-muted p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--texto-tenue)]">
                      Mensaje para quien recibe
                    </h2>
                    <BotonCopiarMensaje mensaje={e.mensajeTarjeta} />
                  </div>
                  <p className="mt-2 text-lg leading-relaxed">
                    {e.mensajeTarjeta}
                  </p>
                </div>
              )}

              {/* El cambio de estado vive aquí y no solo en el detalle porque
                  esta es la pantalla que está abierta mientras se arma y sale
                  la ruta. En la variante compacta solo aparecen los avances:
                  reembolsar o corregir se hace en el detalle, con el pedido
                  entero a la vista. */}
              <div className="mt-5 border-t pt-4 print:hidden">
                <SelectorEstado
                  pedidoId={e.id}
                  estado={e.estado}
                  totalCop={e.totalCop}
                  compacto
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
