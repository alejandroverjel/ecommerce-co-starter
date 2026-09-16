import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, MapPin, Phone, User } from "lucide-react";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { SelectorEstado } from "@/components/admin/estado-pedido";
import { TarjetaPedido } from "@/components/admin/tarjeta-pedido";
import {
  BotonCopiarEntrega,
  BotonWhatsApp,
} from "@/components/admin/contacto-pedido";
import { EditarEntrega } from "@/components/admin/editar-entrega";
import { leerPedidoAdmin } from "@/lib/data/pedido-admin";
import { exigirPersonalPagina } from "@/lib/admin/pagina";
import { SITIO } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";
import { formatearCOP, formatearFechaHora, formatearFechaSola } from "@/lib/formato";
import { etiquetaFranja, etiquetaMetodo } from "@/lib/validaciones/pedido";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const pedido = await leerPedidoAdmin(id);
  return { title: pedido ? pedido.numero : "Pedido" };
}

/** Fila del desglose de dinero. */
function Linea({
  texto,
  valor,
  apagado = false,
}: {
  texto: string;
  valor: string;
  apagado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={apagado ? "text-[var(--texto-tenue)]" : "text-[var(--texto-suave)]"}>
        {texto}
      </span>
      <span className={apagado ? "text-[var(--texto-tenue)]" : ""}>{valor}</span>
    </div>
  );
}

function Bloque({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-6 ${className}`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--texto-tenue)]">
        {titulo}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Detalle del pedido.
 *
 * Todo lo que la operación necesita en una sola pantalla, ordenado por cómo se
 * usa: primero a quién y a dónde va, luego el mensaje de regalo si aplica,
 * luego qué va dentro. El dinero y los pagos quedan a un lado: se
 * consultan, no se ejecutan.
 */
export default async function DetallePedido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirPersonalPagina();
  const { id } = await params;
  const pedido = await leerPedidoAdmin(id);

  if (!pedido) notFound();

  const hayDescuento = pedido.descuentoCop > 0;

  return (
    <div>
      <Link
        href="/admin/pedidos/"
        className="print:hidden inline-flex items-center gap-1.5 text-sm text-[var(--texto-suave)] hover:text-[var(--texto)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Todos los pedidos
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="cifra text-3xl">{pedido.numero}</h1>
            <EtiquetaEstado estado={pedido.estado} />
          </div>
          <p className="mt-1 text-sm text-[var(--texto-suave)]">
            Creado el {formatearFechaHora(pedido.creado)}
            {pedido.pagadoEn && ` · Pagado el ${formatearFechaHora(pedido.pagadoEn)}`}
            {pedido.canceladoEn &&
              ` · Cancelado el ${formatearFechaHora(pedido.canceladoEn)}`}
          </p>
        </div>

        <p className="cifra text-3xl">{formatearCOP(pedido.totalCop)}</p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* ---- Columna de operación ------------------------------------- */}
        <div className="space-y-5">
          <Bloque titulo="Entrega">
            <p className="flex items-center gap-2 font-medium">
              <User className="size-4 text-[var(--texto-tenue)]" aria-hidden />
              {pedido.destinatario ?? "Sin destinatario"}
            </p>

            {pedido.telefonoDestinatario && (
              <span className="mt-1.5 flex flex-wrap items-center gap-3">
                <a
                  href={`tel:${pedido.telefonoDestinatario}`}
                  className="inline-flex items-center gap-2 text-sm text-[var(--acento)]"
                >
                  <Phone className="size-4" aria-hidden />
                  {pedido.telefonoDestinatario}
                </a>
                <BotonWhatsApp
                  telefono={pedido.telefonoDestinatario}
                  mensaje={`Hola${pedido.destinatario ? ` ${pedido.destinatario}` : ""}, te escribimos de ${SITIO.nombre} por tu entrega${pedido.fechaEntrega ? ` del ${formatearFechaSola(pedido.fechaEntrega)}` : ""}.`}
                  etiqueta="WhatsApp"
                />
              </span>
            )}

            <p className="mt-3 flex items-start gap-2 text-sm text-[var(--texto-suave)]">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {pedido.direccion?.line1 ?? "Sin dirección"}
                {pedido.direccion?.line2 && (
                  <span className="block">{pedido.direccion.line2}</span>
                )}
                {pedido.direccion?.ciudad && (
                  <span className="block">
                    {pedido.direccion.ciudad}
                    {pedido.direccion.departamento
                      ? `, ${pedido.direccion.departamento}`
                      : ""}
                  </span>
                )}
              </span>
            </p>

            {pedido.fechaEntrega && (
              <p className="mt-3 flex items-start gap-2 text-sm">
                <CalendarClock
                  className="mt-0.5 size-4 shrink-0 text-[var(--texto-tenue)]"
                  aria-hidden
                />
                <span>
                  {formatearFechaSola(pedido.fechaEntrega)}
                  {pedido.franja && (
                    <span className="block font-medium text-[var(--acento)]">
                      {etiquetaFranja(pedido.franja)}
                    </span>
                  )}
                </span>
              </p>
            )}

            {pedido.indicaciones && (
              <p className="mt-3 rounded-xl bg-[var(--fondo-hondo)] px-3.5 py-2.5 text-sm italic text-[var(--texto-suave)]">
                {pedido.indicaciones}
              </p>
            )}

            <div className="mt-4 border-t pt-3">
              <BotonCopiarEntrega
                datos={{
                  numero: pedido.numero,
                  destinatario: pedido.destinatario,
                  telefono: pedido.telefonoDestinatario,
                  direccion:
                    [pedido.direccion?.line1, pedido.direccion?.line2]
                      .filter(Boolean)
                      .join(", ") || null,
                  ciudad: pedido.direccion?.ciudad ?? null,
                  fecha: pedido.fechaEntrega
                    ? formatearFechaSola(pedido.fechaEntrega)
                    : null,
                  franja: pedido.franja ? etiquetaFranja(pedido.franja) : null,
                  indicaciones: pedido.indicaciones,
                  totalCop: formatearCOP(pedido.totalCop),
                  cobrar:
                    pedido.estado === "pendiente" &&
                    pedido.metodoPago === "contra-entrega",
                }}
              />
            </div>

            <EditarEntrega
              datos={{
                pedidoId: pedido.id,
                fechaEntrega: pedido.fechaEntrega,
                franja: pedido.franja,
                destinatario: pedido.destinatario,
                telefonoDestinatario: pedido.telefonoDestinatario,
                ciudad: pedido.direccion?.ciudad ?? null,
                direccion: pedido.direccion?.line1 ?? null,
                indicaciones: pedido.indicaciones,
              }}
            />
          </Bloque>

          {TIENDA.checkout.mensajeRegalo && (
            <TarjetaPedido
              numero={pedido.numero}
              destinatario={pedido.destinatario}
              mensaje={pedido.mensajeTarjeta}
            />
          )}

          <Bloque titulo={`Qué va (${pedido.articulos.length})`}>
            <ul className="divide-y">
              {pedido.articulos.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0">
                  <div>
                    <p className="text-sm font-medium">
                      {a.cantidad} × {a.nombre}
                    </p>
                    <p className="text-xs text-[var(--texto-tenue)]">
                      {a.variante}
                      {a.sku ? ` · ${a.sku}` : ""} · {formatearCOP(a.precioCop)} c/u
                    </p>
                  </div>
                  <span className="cifra whitespace-nowrap text-sm">
                    {formatearCOP(a.lineaCop)}
                  </span>
                </li>
              ))}
            </ul>
          </Bloque>
        </div>

        {/* ---- Columna de control --------------------------------------- */}
        <div className="space-y-5">
          <Bloque titulo="Estado del pedido" className="print:hidden">
            <SelectorEstado
              pedidoId={pedido.id}
              estado={pedido.estado}
              totalCop={pedido.totalCop}
            />
          </Bloque>

          <Bloque titulo="Quien compra">
            <p className="font-medium">{pedido.compradorNombre ?? "Sin nombre"}</p>
            <a
              href={`mailto:${pedido.correo}`}
              className="mt-1 block break-all text-sm text-[var(--acento)]"
            >
              {pedido.correo}
            </a>
            {pedido.telefono && (
              <span className="mt-1 flex flex-wrap items-center gap-3">
                <a
                  href={`tel:${pedido.telefono}`}
                  className="text-sm text-[var(--acento)]"
                >
                  {pedido.telefono}
                </a>
                <BotonWhatsApp
                  telefono={pedido.telefono}
                  mensaje={`Hola${pedido.compradorNombre ? ` ${pedido.compradorNombre}` : ""}, te escribimos de ${SITIO.nombre} sobre tu pedido ${pedido.numero}.`}
                  etiqueta="WhatsApp"
                />
              </span>
            )}
            {!pedido.usuarioId && (
              <p className="mt-2 text-xs text-[var(--texto-tenue)]">
                Compró como invitado, sin cuenta.
              </p>
            )}
          </Bloque>

          <Bloque titulo="Dinero">
            <div className="space-y-1.5">
              <Linea texto="Subtotal" valor={formatearCOP(pedido.subtotalCop)} />
              {hayDescuento && (
                <Linea
                  texto={pedido.cupon ? `Descuento (${pedido.cupon})` : "Descuento"}
                  valor={`− ${formatearCOP(pedido.descuentoCop)}`}
                />
              )}
              <Linea
                texto="Envío"
                valor={
                  pedido.envioCop === 0 ? "Gratis" : formatearCOP(pedido.envioCop)
                }
              />
            </div>

            <div className="mt-3 flex items-baseline justify-between gap-4 border-t pt-3">
              <span className="text-sm font-medium">Total</span>
              <span className="cifra text-xl">{formatearCOP(pedido.totalCop)}</span>
            </div>

            {pedido.metodoPago && (
              <p className="mt-3 text-xs text-[var(--texto-tenue)]">
                El cliente eligió: {etiquetaMetodo(pedido.metodoPago)}
              </p>
            )}
          </Bloque>

          <Bloque titulo={`Pagos (${pedido.pagos.length})`}>
            {pedido.pagos.length === 0 ? (
              <p className="text-sm text-[var(--texto-tenue)]">
                Todavía no hay ningún cobro registrado.
              </p>
            ) : (
              <ul className="space-y-3">
                {pedido.pagos.map((p) => (
                  <li key={p.id} className="border-b pb-3 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="cifra text-sm">{formatearCOP(p.montoCop)}</span>
                      <EtiquetaEstado estado={p.estado} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--texto-suave)]">
                      {p.pasarela === "manual"
                        ? `A mano${p.medio ? ` · ${p.medio}` : ""}`
                        : p.pasarela}
                      {p.pagado ? ` · ${formatearFechaHora(p.pagado)}` : ""}
                    </p>
                    {p.referencia && (
                      <p className="text-xs text-[var(--texto-tenue)]">
                        Ref. {p.referencia}
                      </p>
                    )}
                    {p.nota && (
                      <p className="text-xs italic text-[var(--texto-tenue)]">{p.nota}</p>
                    )}
                    {p.externalId && p.pasarela !== "manual" && (
                      <p className="break-all text-xs text-[var(--texto-tenue)]">
                        {p.externalId}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Bloque>

          {/* Diagnóstico. Se ve porque cuando algo se atasca —stock que no
              bajó, un token pegado— esto es lo primero que hay que mirar, y
              hoy eso obliga a entrar a psql. */}
          <Bloque titulo="Control" className="print:hidden">
            <div className="space-y-1.5">
              <Linea
                texto="Inventario descontado"
                valor={
                  pedido.stockDescontadoEn
                    ? formatearFechaHora(pedido.stockDescontadoEn)
                    : "Todavía no"
                }
                apagado
              />
              <Linea
                texto="Sesión de checkout"
                valor={pedido.tokenCheckout ? "Activa" : "Liberada"}
                apagado
              />
            </div>
          </Bloque>
        </div>
      </div>
    </div>
  );
}
