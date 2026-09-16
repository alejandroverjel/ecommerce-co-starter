import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarHeart, Sparkles } from "lucide-react";

import { TIENDA } from "@/tienda.config";
import type { CampanaVigente } from "@/lib/data/campanas";
import { buttonVariants } from "@/components/ui/button";

/**
 * Módulo de temporada (Navidad, San Valentín, etc.).
 *
 * SU TÍTULO ES UN H2, NUNCA UN H1: la portada ya tiene el suyo, y la campaña
 * suma un mensaje, no lo sustituye.
 *
 * La foto va a sangre de fondo cuando la hay; si no, el módulo queda como una
 * franja de color plano con el mismo contenido.
 */
export function FranjaCampana({ campana }: { campana: CampanaVigente }) {
  const {
    titulo,
    cuerpo,
    imagenUrl,
    imagenMovilUrl,
    imagenAlt,
    colorFondo,
    ctaTexto,
    ctaRuta,
    diasRestantes,
  } = campana;

  return (
    <section
      aria-labelledby="campana-titulo"
      className="relative overflow-hidden bg-muted"
      style={colorFondo ? { backgroundColor: colorFondo } : undefined}
    >
      {imagenUrl && (
        <div className="relative aspect-[5/4] w-full lg:hidden">
          <Image
            src={imagenMovilUrl ?? imagenUrl}
            alt={imagenAlt}
            fill
            sizes="100vw"
            className="object-cover object-top"
          />
        </div>
      )}

      {imagenUrl && (
        <div aria-hidden className="absolute inset-0 hidden lg:block">
          {/* Anclada a la derecha: si la franja queda más alta que la
              proporción de la foto, lo que se recorta es el fondo, no el
              sujeto. */}
          <Image
            src={imagenUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-right"
          />
        </div>
      )}

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <div className="max-w-xl lg:max-w-[46%]">
          <span className="inline-flex items-center gap-2 rounded-full bg-background/95 px-4 py-1.5 text-sm font-medium shadow-sm">
            <Sparkles className="size-4" aria-hidden />
            Promoción
          </span>

          <h2
            id="campana-titulo"
            className="display mt-5 text-balance text-[clamp(2.1rem,5vw,3.5rem)] leading-[1.05] text-foreground"
          >
            {titulo}
          </h2>

          {/* `whitespace-pre-line` respeta los saltos que se escriban en el
              panel: quien redacta separa en párrafos y espera verlos. */}
          <p className="mt-6 whitespace-pre-line text-lg leading-relaxed text-foreground">
            {cuerpo}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            {ctaTexto && ctaRuta && (
              <Link
                href={ctaRuta}
                className={buttonVariants({
                  size: "lg",
                  className: "h-auto gap-2 rounded-full px-7 py-3.5",
                })}
              >
                {ctaTexto}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}

            {/* La urgencia sale de la fecha guardada: cuando la campaña
                termina, el módulo entero desaparece solo. */}
            {diasRestantes <= TIENDA.campanas.diasCuentaRegresiva && (
              <p className="inline-flex items-center gap-2 rounded-full bg-background/85 px-3.5 py-1.5 text-sm font-medium">
                <CalendarHeart className="size-4 shrink-0" aria-hidden />
                {diasRestantes === 0
                  ? "Último día"
                  : diasRestantes === 1
                    ? "Queda 1 día"
                    : `Quedan ${diasRestantes} días`}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
