import Link from "next/link";
import { AlertTriangle, ArrowRight, Package, Receipt, Truck, Users } from "lucide-react";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { leerResumen, listarAgotados, listarPedidos } from "@/lib/data/admin";
import { exigirPersonalPagina } from "@/lib/admin/pagina";
import { formatearCOP, formatearFecha } from "@/lib/formato";
import { hoyEnBogota } from "@/lib/validaciones/pedido";

export const dynamic = "force-dynamic";

function Dato({
  etiqueta,
  valor,
  icono: Icono,
  nota,
}: {
  etiqueta: string;
  valor: string;
  icono: typeof Package;
  nota?: string;
}) {
  return (
    <div className="rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-[var(--texto-suave)]">{etiqueta}</p>
        <Icono className="size-4 shrink-0 text-[var(--texto-tenue)]" aria-hidden />
      </div>
      <p className="cifra mt-2 text-2xl">{valor}</p>
      {nota && <p className="mt-1 text-xs text-[var(--texto-tenue)]">{nota}</p>}
    </div>
  );
}

export default async function ResumenAdmin() {
  await exigirPersonalPagina();
  const hoy = hoyEnBogota();

  const [resumen, recientes, agotados] = await Promise.all([
    leerResumen(hoy),
    listarPedidos({ limite: 8 }),
    listarAgotados(),
  ]);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato
          etiqueta="Entregas hoy"
          valor={String(resumen.entregasHoy)}
          icono={Truck}
          nota="Pagados o en preparación"
        />
        <Dato
          etiqueta="Ventas cobradas"
          valor={formatearCOP(resumen.ventasCop)}
          icono={Receipt}
          nota={`${resumen.pedidosPagados} pedidos pagados`}
        />
        <Dato
          etiqueta="Sin pagar"
          valor={String(resumen.pedidosPendientes)}
          icono={Receipt}
          nota="Pedidos pendientes de pago"
        />
        <Dato
          etiqueta="Clientes"
          valor={String(resumen.clientes)}
          icono={Users}
          nota={`${resumen.productosActivos} productos activos`}
        />
      </div>

      {/* Los agotados van arriba de los pedidos: es lo único de esta pantalla
          que exige actuar hoy, porque son ventas que se están perdiendo. */}
      {agotados.length > 0 && (
        <section className="rounded-[var(--radius-tarjeta)] border border-[var(--peligro-borde)] bg-[var(--peligro-fondo)] p-6">
          <h2 className="flex items-center gap-2 font-medium text-[var(--peligro)]">
            <AlertTriangle className="size-4" aria-hidden />
            {agotados.length} {agotados.length === 1 ? "producto agotado" : "productos agotados"}
          </h2>
          <p className="mt-1 text-sm text-[var(--peligro)]/80">
            Están publicados pero no se pueden comprar.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {agotados.slice(0, 12).map((p) => (
              <li
                key={p.id}
                className="rounded-full bg-[var(--fondo-elevado)] px-3 py-1.5 text-sm"
              >
                {p.nombre}
              </li>
            ))}
            {agotados.length > 12 && (
              <li className="px-3 py-1.5 text-sm text-[var(--peligro)]">
                y {agotados.length - 12} más
              </li>
            )}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="display text-2xl">Pedidos recientes</h2>
          <Link
            href="/admin/pedidos/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--acento)] hover:underline"
          >
            Ver todos
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        {recientes.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-10 text-center text-sm text-[var(--texto-suave)]">
            Todavía no hay pedidos.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-widest text-[var(--texto-tenue)]">
                  <th className="px-5 py-3 font-semibold">Pedido</th>
                  <th className="px-5 py-3 font-semibold">Cliente</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-5 py-3">
                      <span className="cifra">{p.numero}</span>
                      <span className="block text-xs text-[var(--texto-tenue)]">
                        {formatearFecha(p.creado)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {p.cliente ?? "—"}
                      <span className="block text-xs text-[var(--texto-tenue)]">
                        {p.correo}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <EtiquetaEstado estado={p.estado} />
                    </td>
                    <td className="cifra whitespace-nowrap px-5 py-3 text-right">
                      {formatearCOP(p.totalCop)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
