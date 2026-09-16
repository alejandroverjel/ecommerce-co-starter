import Image from "next/image";
import Link from "next/link";

import type { ProductoLista } from "@/lib/data/catalogo";
import { formatearCOP } from "@/lib/formato";

/**
 * Ficha de producto en listados.
 *
 * La foto manda: estos productos se compran por cómo se ven. La interfaz se
 * mantiene callada alrededor —sin bordes duros, sin insignias de colores— para
 * no competir con la fotografía.
 */
export function TarjetaProducto({
  producto,
  prioridad = false,
}: {
  producto: ProductoLista;
  /** `true` para las primeras fichas visibles: evita que la portada cargue lento. */
  prioridad?: boolean;
}) {
  const agotado = !producto.disponible;

  return (
    <article className="group">
      <Link href={producto.ruta} className="block">
        <div className="relative aspect-square overflow-hidden rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)] shadow-[var(--sombra-tarjeta)]">
          {producto.imagen ? (
            <Image
              src={producto.imagen.url}
              alt={producto.imagen.alt}
              fill
              sizes="(min-width: 1280px) 22rem, (min-width: 768px) 33vw, 50vw"
              priority={prioridad}
              // Ver nota en galeria.tsx: Next 16.2 no emite fetchpriority solo.
              fetchPriority={prioridad ? "high" : undefined}
              className={`object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] ${
                agotado ? "opacity-55" : ""
              }`}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-[var(--texto-tenue)]">
              Sin foto
            </div>
          )}

          {agotado && (
            <div className="absolute inset-x-0 bottom-0 bg-foreground/85 py-2 text-center text-xs font-medium tracking-wide text-background">
              Agotado por ahora
            </div>
          )}
        </div>

        <div className="mt-3.5 space-y-1">
          <h3 className="titulo-producto text-[0.9375rem] leading-snug text-[var(--texto)] lineas-2">
            {producto.nombre}
          </h3>

          <p className="cifra text-lg text-[var(--texto)]">
            {formatearCOP(producto.precioCop)}
            {producto.precioAntesCop && (
              <>
                {" "}
                <span className="text-sm font-normal text-[var(--texto-tenue)] line-through">
                  {formatearCOP(producto.precioAntesCop)}
                </span>
              </>
            )}
          </p>
        </div>
      </Link>
    </article>
  );
}

/**
 * Rejilla de fichas.
 *
 * Dos columnas en móvil: en una tienda visual, ver dos productos a la vez
 * ayuda a comparar más que ver uno grande.
 */
export function RejillaProductos({
  productos,
  prioridadHasta = 4,
}: {
  productos: ProductoLista[];
  prioridadHasta?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
      {productos.map((p, i) => (
        <li key={p.id}>
          <TarjetaProducto producto={p} prioridad={i < prioridadHasta} />
        </li>
      ))}
    </ul>
  );
}
