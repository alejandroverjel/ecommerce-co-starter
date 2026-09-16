import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus, Ticket } from "lucide-react";

import { listarCupones } from "@/lib/data/cupones-admin";
import { exigirAdminPagina } from "@/lib/admin/pagina";
import { formatearCOP } from "@/lib/formato";

export const metadata: Metadata = { title: "Cupones" };
export const dynamic = "force-dynamic";

const ESTADO: Record<string, { texto: string; clase: string }> = {
  vigente: { texto: "Vigente", clase: "bg-[var(--exito)]/15 text-[var(--disponible)]" },
  programado: { texto: "Programado", clase: "bg-[var(--aviso)]/15 text-[var(--aviso)]" },
  vencido: { texto: "Vencido", clase: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]" },
  apagado: { texto: "Apagado", clase: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]" },
};

/** El descuento en una frase, según el tipo. */
function descripcionDescuento(tipo: string, value: number): string {
  if (tipo === "envio_gratis") return "Envío gratis";
  if (tipo === "porcentaje") return `${value / 100} % de descuento`;
  return `${formatearCOP(value)} de descuento`;
}

export default async function CuponesAdmin() {
  await exigirAdminPagina();
  const cupones = await listarCupones();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Cupones</h1>
          <p className="mt-1 text-[var(--texto-suave)]">
            Descuentos para campañas y redes sociales. {cupones.length}{" "}
            {cupones.length === 1 ? "cupón" : "cupones"}.
          </p>
        </div>
        <Link
          href="/admin/cupones/nuevo/"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-5 py-2.5 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo cupón
        </Link>
      </div>

      {cupones.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-12 text-center">
          <Ticket className="mx-auto size-8 text-[var(--texto-tenue)]" aria-hidden />
          <p className="display mt-3 text-xl">Todavía no hay cupones</p>
          <p className="mt-2 text-sm text-[var(--texto-suave)]">
            Crea uno para una campaña —un 10 % de bienvenida o envío gratis por una temporada—
            y compártelo en tus redes.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-widest text-[var(--texto-tenue)]">
                <th className="px-5 py-3 font-semibold">Código</th>
                <th className="px-5 py-3 font-semibold">Descuento</th>
                <th className="px-5 py-3 font-semibold">Usos</th>
                <th className="px-5 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3">
                  <span className="solo-lectores">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cupones.map((c) => (
                <tr key={c.id} className="border-b transition-colors last:border-0 hover:bg-[var(--fondo-hondo)]">
                  <td className="whitespace-nowrap px-5 py-3">
                    <Link href={`/admin/cupones/${c.id}/`} className="cifra hover:underline">
                      {c.code}
                    </Link>
                    {c.minSubtotalCop > 0 && (
                      <span className="block text-xs text-[var(--texto-tenue)]">
                        desde {formatearCOP(c.minSubtotalCop)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[var(--texto-suave)]">
                    {descripcionDescuento(c.tipo, c.value)}
                  </td>
                  <td className="cifra whitespace-nowrap px-5 py-3">
                    {c.usos}
                    {c.usageLimit != null && (
                      <span className="text-[var(--texto-tenue)]"> / {c.usageLimit}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${ESTADO[c.estado].clase}`}
                    >
                      {ESTADO[c.estado].texto}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/cupones/${c.id}/`}
                      aria-label={`Abrir el cupón ${c.code}`}
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
