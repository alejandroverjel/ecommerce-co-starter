import Link from "next/link";

import { TIENDA } from "@/tienda.config";

/**
 * Filtros de la tienda: categoría y orden por precio.
 *
 * Son enlaces (GET), no JavaScript: la selección queda en la URL —compartible,
 * indexable, con botón atrás—, y funciona sin JS. El buscador y estos filtros
 * son excluyentes: al filtrar por categoría se limpia la búsqueda.
 */

const ORDENES = [
  { valor: "precio-asc", etiqueta: "Menor precio" },
  { valor: "precio-desc", etiqueta: "Mayor precio" },
] as const;

export function FiltrosTienda({
  categoria,
  orden,
  categorias,
}: {
  categoria: string;
  orden: string;
  categorias: { slug: string; nombre: string }[];
}) {
  // Construye /tienda/ con los parámetros dados, omitiendo los vacíos o por defecto.
  const url = (cat: string, ord: string) => {
    const p = new URLSearchParams();
    if (cat) p.set("categoria", cat);
    if (ord && ord !== TIENDA.catalogo.ordenPorDefecto) p.set("orden", ord);
    const qs = p.toString();
    return `/tienda/${qs ? `?${qs}` : ""}`;
  };

  const chip = (activo: boolean) =>
    `rounded-full px-4 py-2 text-sm font-medium transition-colors ${
      activo
        ? "bg-[var(--acento)] text-[var(--acento-texto)]"
        : "border bg-[var(--fondo-elevado)] text-[var(--texto-suave)] hover:bg-[var(--fondo-hondo)]"
    }`;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
        <Link href={url("", orden)} aria-current={!categoria ? "true" : undefined} className={chip(!categoria)}>
          Todas
        </Link>
        {categorias.map((c) => (
          <Link
            key={c.slug}
            href={url(c.slug, orden)}
            aria-current={categoria === c.slug ? "true" : undefined}
            className={chip(categoria === c.slug)}
          >
            {c.nombre}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2" role="group" aria-label="Ordenar por precio">
        <span className="text-sm text-[var(--texto-tenue)]">Precio:</span>
        {ORDENES.map((o) => (
          <Link
            key={o.valor}
            href={url(categoria, o.valor)}
            aria-current={orden === o.valor ? "true" : undefined}
            className={`text-sm font-medium transition-colors ${
              orden === o.valor
                ? "text-[var(--acento)] underline"
                : "text-[var(--texto-suave)] hover:text-[var(--texto)]"
            }`}
          >
            {o.etiqueta}
          </Link>
        ))}
      </div>
    </div>
  );
}
