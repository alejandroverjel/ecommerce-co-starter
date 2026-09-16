import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { listarPedidos, resumenPedidos } from "@/lib/data/admin";
import { resumenCarritosAbandonados } from "@/lib/data/carrito-abandonado";
import { exigirPersonalPagina } from "@/lib/admin/pagina";
import { formatearCOP, formatearFechaHora, formatearFechaSola } from "@/lib/formato";
import { etiquetaFranja, etiquetaMetodo } from "@/lib/validaciones/pedido";

export const metadata: Metadata = { title: "Pedidos" };
export const dynamic = "force-dynamic";

/** Chips de filtro. Solo los estados que se consultan de verdad en el día a día. */
const FILTROS_ESTADO = [
  { valor: "", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "pagado", etiqueta: "Pagados" },
  { valor: "enviado", etiqueta: "En camino" },
  { valor: "entregado", etiqueta: "Entregados" },
  { valor: "cancelado", etiqueta: "Cancelados" },
] as const;

export default async function PedidosAdmin({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>;
}) {
  await exigirPersonalPagina();
  const { estado = "", q = "" } = await searchParams;

  const [pedidos, resumen, carritos] = await Promise.all([
    listarPedidos({ estado: estado || undefined, buscar: q || undefined, limite: 100 }),
    resumenPedidos(),
    resumenCarritosAbandonados(),
  ]);

  const filtrando = Boolean(estado || q.trim());

  // El resumen mira TODA la tabla; la lista de abajo son los 100 últimos.
  const tarjetas = [
    { etiqueta: "Pedidos", valor: String(resumen.total) },
    { etiqueta: "Hoy", valor: String(resumen.hoy) },
    { etiqueta: "Pendientes", valor: String(resumen.pendientes) },
    { etiqueta: "Pagados", valor: String(resumen.pagados) },
    { etiqueta: "Vendido", valor: formatearCOP(resumen.vendidoCop) },
  ];

  return (
    <div>
      <h1 className="display text-3xl">Pedidos</h1>
      <p className="mt-1 text-[var(--texto-suave)]">
        {resumen.total} en total. Abajo, los {pedidos.length} más recientes.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tarjetas.map((t) => (
          <div
            key={t.etiqueta}
            className="rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] px-4 py-3"
          >
            <dt className="text-xs uppercase tracking-widest text-[var(--texto-tenue)]">
              {t.etiqueta}
            </dt>
            <dd className="cifra mt-1 text-2xl">{t.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Carritos abandonados: solo si hay algo que contar, para no ocupar
          espacio con ceros mientras el sistema aún no ha recogido nada. */}
      {carritos.pendientes + carritos.avisados > 0 && (
        <p className="mt-3 text-sm text-[var(--texto-suave)]">
          Carritos abandonados: <strong>{carritos.pendientes}</strong> en espera
          · <strong>{carritos.avisados}</strong> avisados ·{" "}
          <strong>{carritos.recuperados}</strong> recuperados
        </p>
      )}

      {/* Búsqueda y filtros. Form GET: la URL queda compartible y el botón
          atrás del navegador deshace el filtro, sin JavaScript propio. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action="/admin/pedidos/" className="relative">
          {estado && <input type="hidden" name="estado" value={estado} />}
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--texto-tenue)]"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Número, nombre o correo…"
            aria-label="Buscar pedidos por número, nombre o correo"
            className="w-64 rounded-full border bg-[var(--fondo-elevado)] py-2 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]"
          />
        </form>

        <div className="flex flex-wrap gap-1.5">
          {FILTROS_ESTADO.map((f) => {
            const activo = estado === f.valor;
            const destino = new URLSearchParams();
            if (f.valor) destino.set("estado", f.valor);
            if (q.trim()) destino.set("q", q.trim());
            const consulta = destino.toString();

            return (
              <Link
                key={f.valor || "todos"}
                href={`/admin/pedidos/${consulta ? `?${consulta}` : ""}`}
                aria-current={activo ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  activo
                    ? "bg-[var(--acento)] font-medium text-[var(--acento-texto)]"
                    : "border bg-[var(--fondo-elevado)] text-[var(--texto-suave)] hover:bg-[var(--fondo-hondo)]"
                }`}
              >
                {f.etiqueta}
              </Link>
            );
          })}
        </div>
      </div>

      {pedidos.length === 0 ? (
        <p className="mt-6 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-12 text-center text-sm text-[var(--texto-suave)]">
          {filtrando
            ? "Nada coincide con ese filtro. Prueba con otro término o quita el filtro."
            : "Todavía no hay pedidos."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-widest text-[var(--texto-tenue)]">
                <th className="px-5 py-3 font-semibold">Pedido</th>
                <th className="px-5 py-3 font-semibold">Cliente</th>
                <th className="px-5 py-3 font-semibold">Pago</th>
                <th className="px-5 py-3 font-semibold">Entrega</th>
                <th className="px-5 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
                <th className="px-5 py-3">
                  <span className="solo-lectores">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr
                  key={p.id}
                  className="border-b transition-colors last:border-0 hover:bg-[var(--fondo-hondo)]"
                >
                  <td className="whitespace-nowrap px-5 py-3">
                    {/* El número es el enlace: es lo que la gente busca con la
                        vista y lo que dicta por teléfono. */}
                    <Link
                      href={`/admin/pedidos/${p.id}/`}
                      className="cifra hover:underline"
                    >
                      {p.numero}
                    </Link>
                    <span className="block text-xs text-[var(--texto-tenue)]">
                      {formatearFechaHora(p.creado)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {p.cliente ?? "—"}
                    <span className="block text-xs text-[var(--texto-tenue)]">
                      {p.correo}
                    </span>
                    {/* El teléfono es lo que se usa para coordinar la entrega:
                        va a la vista para no tener que abrir cada pedido. */}
                    {p.telefono && (
                      <a
                        href={`tel:${p.telefono}`}
                        className="text-xs text-[var(--texto-tenue)] hover:text-[var(--acento)]"
                      >
                        {p.telefono}
                      </a>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-[var(--texto-suave)]">
                    {p.metodoPago ? etiquetaMetodo(p.metodoPago) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-[var(--texto-suave)]">
                    {p.fechaEntrega ? formatearFechaSola(p.fechaEntrega) : "—"}
                    {p.franja && (
                      <span className="block text-xs text-[var(--texto-tenue)]">
                        {etiquetaFranja(p.franja)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <EtiquetaEstado estado={p.estado} />
                  </td>
                  <td className="cifra whitespace-nowrap px-5 py-3 text-right">
                    {formatearCOP(p.totalCop)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/pedidos/${p.id}/`}
                      aria-label={`Abrir el pedido ${p.numero}`}
                      className="inline-flex text-[var(--texto-tenue)] hover:text-[var(--acento)]"
                    >
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
