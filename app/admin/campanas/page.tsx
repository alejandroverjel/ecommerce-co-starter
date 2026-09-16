import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Megaphone, Plus } from "lucide-react";

import { listarCampanas } from "@/lib/data/campanas-admin";
import { exigirAdminPagina } from "@/lib/admin/pagina";
import { formatearFechaSola } from "@/lib/formato";

export const metadata: Metadata = { title: "Campañas" };
export const dynamic = "force-dynamic";

const ESTADO: Record<string, { texto: string; clase: string }> = {
  vigente: { texto: "En portada", clase: "bg-[var(--exito)]/15 text-[var(--disponible)]" },
  proxima: { texto: "Programada", clase: "bg-[var(--aviso)]/15 text-[var(--aviso)]" },
  terminada: { texto: "Terminada", clase: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]" },
  apagada: { texto: "Apagada", clase: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]" },
};

export default async function CampanasAdmin() {
  await exigirAdminPagina();
  const campanas = await listarCampanas();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Campañas</h1>
          <p className="mt-1 text-[var(--texto-suave)]">
            El módulo de temporada de la portada. Se enciende solo dentro de sus fechas.
          </p>
        </div>
        <Link
          href="/admin/campanas/nueva/"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-5 py-2.5 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
        >
          <Plus className="size-4" aria-hidden />
          Nueva campaña
        </Link>
      </div>

      {campanas.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-12 text-center">
          <Megaphone className="mx-auto size-8 text-[var(--texto-tenue)]" aria-hidden />
          <p className="display mt-3 text-xl">Todavía no hay campañas</p>
          <p className="mt-2 text-sm text-[var(--texto-suave)]">
            Crea una para Black Friday, el Día de la Madre o Navidad: aparece en la portada entre
            sus fechas y se apaga sola.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {campanas.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/campanas/${c.id}/`}
                className="flex items-center gap-4 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-4 transition-colors hover:bg-[var(--fondo-hondo)]"
              >
                <span
                  className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${ESTADO[c.estado].clase}`}
                >
                  {ESTADO[c.estado].texto}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.titulo}</p>
                  <p className="text-xs text-[var(--texto-tenue)]">
                    {c.nombre} · {formatearFechaSola(c.inicio)} — {formatearFechaSola(c.fin)}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-[var(--texto-tenue)]" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
