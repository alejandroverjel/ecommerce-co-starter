import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { Encabezado } from "@/components/layout/encabezado";
import { Pie } from "@/components/layout/pie";
import { BotonWhatsapp } from "@/components/layout/boton-whatsapp";
import { PanelCarritoServidor } from "@/components/carrito/panel-carrito-servidor";
import { Analitica } from "@/components/analitica/analitica";
import { MARCA, SITIO } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";

import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(SITIO.dominio),
  title: {
    default: TIENDA.seo.tituloPorDefecto,
    // Las páginas internas heredan la marca sin repetirla a mano.
    template: `%s · ${SITIO.nombre}`,
  },
  description: SITIO.descripcion,
  applicationName: SITIO.nombre,
  authors: [{ name: SITIO.nombre }],
  generator: null,
  keywords: TIENDA.seo.keywords,
  /**
   * SIN canónico ni og:url globales, a propósito.
   *
   * El canónico "/" del layout se heredaba: cualquier página sin `alternates`
   * propio se autocanonicalizaba a la PORTADA — para Google, "esta página es
   * una copia de la home, no la indexes". Y el og:url fijo hacía que
   * compartir /contactenos/ en redes atribuyera el enlace a la home.
   * Cada página declara los suyos con `metadatosDePagina()` (lib/seo.ts).
   */
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: SITIO.nombre,
    title: TIENDA.seo.tituloPorDefecto,
    description: SITIO.descripcion,
    // Es lo que se ve al pegar el enlace en WhatsApp o redes. Sin teléfono:
    // ese dato es de la tienda, no del layout. Se omite del todo si la
    // tienda no configuró imagen de compartir.
    images: MARCA.compartir
      ? [
          {
            url: MARCA.compartir,
            width: 1200,
            height: 630,
            alt: SITIO.nombre,
          },
        ]
      : undefined,
  },
  twitter: {
    card: "summary_large_image",
    title: TIENDA.seo.tituloPorDefecto,
    description: SITIO.descripcion,
    images: MARCA.compartir ? [MARCA.compartir] : undefined,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
};

export const viewport: Viewport = {
  themeColor: TIENDA.seo.colorTema,
};

/**
 * Categorías para el menú (encabezado y pie).
 *
 * Se cargan aquí, en el servidor, para no repetir la consulta en cada
 * página. El build de Docker no tiene DATABASE_URL, así que la carga va en
 * try/catch y responde [] si falla — mismo patrón que
 * panel-carrito-servidor. Solo se listan las que ya tienen producto
 * publicado: un enlace a una categoría vacía es peor que no tener el enlace.
 */
async function categoriasMenu(): Promise<{ slug: string; nombre: string }[]> {
  try {
    const { listarCategorias } = await import("@/lib/data/catalogo");
    const categorias = await listarCategorias();
    return categorias
      .filter((c) => c.cuantosProductos > 0)
      .map((c) => ({ slug: c.slug, nombre: c.nombre }));
  } catch {
    return [];
  }
}

export default async function LayoutRaiz({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const categorias = await categoriasMenu();

  return (
    <html lang={SITIO.idioma} className={cn("font-sans", geist.variable)}>
      <body className="min-h-dvh flex flex-col">
        {/* Salto al contenido: primer elemento enfocable de la página. */}
        <a
          href="#contenido"
          className="solo-lectores focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--fondo-elevado)] focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:shadow-[var(--sombra-levanta)]"
        >
          Saltar al contenido
        </a>

        <Encabezado categorias={categorias} />

        <main id="contenido" className="flex-1">
          {children}
        </main>

        <Pie categorias={categorias} />
        <BotonWhatsapp />
        <PanelCarritoServidor />
        <Analitica />
      </body>
    </html>
  );
}
