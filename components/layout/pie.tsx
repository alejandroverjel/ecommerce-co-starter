import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { CONTACTO, REDES, SITIO } from "@/lib/sitio";

type Categoria = { slug: string; nombre: string };

/**
 * Íconos de marca de las redes. lucide-react no trae logos de terceros, así
 * que van como SVG propios. Usan `currentColor` para heredar el color del
 * enlace (gris → acento en hover).
 */
type IconoRed = ComponentType<SVGProps<SVGSVGElement>>;

const IconoInstagram: IconoRed = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.12 1.38C1.35 2.67.94 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.47 1.38 2.13.66.66 1.34 1.07 2.12 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.86 5.86 0 0 0 2.13-1.38 5.86 5.86 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.86 5.86 0 0 0-1.38-2.13A5.86 5.86 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4zm6.4-10.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44z" />
  </svg>
);

const IconoFacebook: IconoRed = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647z" />
  </svg>
);

const IconoYouTube: IconoRed = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

/** El nombre de la red (de REDES) al ícono de su marca. */
const ICONO_RED: Record<string, IconoRed> = {
  Instagram: IconoInstagram,
  Facebook: IconoFacebook,
  YouTube: IconoYouTube,
};

const LEGALES = [
  { href: "/politica-de-entrega/", texto: "Política de entrega" },
  { href: "/politica-de-devoluciones/", texto: "Política de devoluciones" },
  { href: "/terminos-y-condiciones/", texto: "Términos y condiciones" },
  { href: "/politica-de-privacidad/", texto: "Política de privacidad" },
];

/** Pie en 3 columnas: tienda, catálogo, y ayuda y legales. */
export function Pie({ categorias }: { categorias: Categoria[] }) {
  const año = new Date().getFullYear();

  return (
    <footer className="border-t bg-card">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <span className="display text-lg">{SITIO.nombre}</span>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {SITIO.descripcion}
            </p>
            {CONTACTO.telefonoFormateado && (
              <p className="mt-4 text-sm text-muted-foreground">
                {CONTACTO.telefonoFormateado}
              </p>
            )}
          </div>

          <nav aria-labelledby="pie-catalogo">
            <h2 id="pie-catalogo" className="text-xs font-semibold uppercase tracking-widest">
              Catálogo
            </h2>
            <ul className="mt-4 space-y-2.5">
              {categorias.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/${c.slug}/`}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  >
                    {c.nombre}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/tienda/"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                >
                  Ver todo
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="pie-ayuda">
            <h2 id="pie-ayuda" className="text-xs font-semibold uppercase tracking-widest">
              Ayuda
            </h2>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link
                  href="/contactenos/"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                >
                  Contáctenos
                </Link>
              </li>
              {LEGALES.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  >
                    {l.texto}
                  </Link>
                </li>
              ))}
            </ul>

            {REDES.length > 0 && (
              <>
                <h2 className="mt-7 text-xs font-semibold uppercase tracking-widest">
                  Síguenos
                </h2>
                <ul className="mt-4 flex gap-3">
                  {REDES.filter((r) => ICONO_RED[r.nombre]).map((r) => {
                    const Icono = ICONO_RED[r.nombre];
                    return (
                      <li key={r.nombre}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={r.nombre}
                          className="grid size-10 place-items-center rounded-full border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          <Icono className="size-[18px]" aria-hidden />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </nav>
        </div>

        <div className="mt-10 border-t pt-6">
          <p className="text-xs text-muted-foreground">
            © {año} {SITIO.nombre} · {SITIO.ciudad}, Colombia
          </p>
        </div>
      </div>
    </footer>
  );
}
