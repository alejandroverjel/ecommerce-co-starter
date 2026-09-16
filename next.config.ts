import type { NextConfig } from "next";

/**
 * Configuración de Next.js.
 *
 * Las redirecciones de una migración concreta (otra plataforma, un cambio de
 * dominio) NO viven aquí: se generan desde un mapa de URLs propio de esa
 * tienda. El patrón está en la guía de migración de docs/.
 */
const nextConfig: NextConfig = {
  // Salida standalone: el Dockerfile solo copia el servidor y sus
  // dependencias reales, no todo node_modules.
  output: "standalone",

  /**
   * La raíz del proyecto es ESTA carpeta.
   *
   * Hay un package.json suelto en el HOME del usuario y Next lo tomaba como
   * raíz de un monorepo: el build avisaba "inferred your workspace root" y la
   * salida standalone quedaba anidada en .next/standalone/<ruta del HOME>/
   * en vez de .next/standalone/. En Docker no se notaba (el contexto es /app,
   * sin nada por encima), pero cualquier prueba local del standalone buscaba
   * server.js donde no estaba.
   */
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },

  // La mayoría de plataformas de origen sirven las URLs con barra final. Mantenerlo conserva las URLs exactamente como quedaron
  // indexadas y evita una redirección extra en cada visita.
  trailingSlash: true,

  poweredByHeader: false,

  images: {
    /**
     * Solo WebP, sin AVIF. No es un descuido:
     *
     * 1. Cloudflare Free ignora `Vary: Accept`, así que con dos formatos
     *    posibles el borde no puede cachear /_next/image sin riesgo de darle
     *    AVIF a un navegador que no lo lee. Con un formato único la respuesta
     *    no depende del navegador y el borde puede cachearla.
     * 2. Codificar AVIF costaba ~2.4s por imagen sobre la única CPU del
     *    contenedor; WebP es un orden de magnitud más barato y las fuentes ya
     *    son WebP optimizado, donde AVIF apenas recorta unos KB.
     */
    formats: ["image/webp"],
    // Las imágenes se sirven desde el volumen local, no desde un CDN externo.
    remotePatterns: [],
  },

  experimental: {
    // Permite Server Actions detrás del proxy. Se deriva del dominio de la
    // tienda para no repetirlo a mano en cada instancia.
    serverActions: {
      allowedOrigins: (() => {
        const host = new URL(
          process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        ).hostname;
        return host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];
      })(),
    },
  },

  // Las redirecciones de una migración van generadas desde el mapa de URLs
  // propio de esa tienda (ver la guía de migración en docs/), no aquí.
  async redirects() {
    return [
      /**
       * `/tienda/{categoria}/` → `/{categoria}/` con 301 literal.
       *
       * La página de app/(shop)/tienda/[categoria]/ hace lo mismo con
       * permanentRedirect(), pero eso emite 308. Aquí se declara con
       * `statusCode: 301` (`permanent: true` también daría 308) para que la
       * redirección sea la clásica que esperan las herramientas de SEO. El
       * patrón solo casa un segmento: la ficha /tienda/{categoria}/{producto}/
       * no se toca.
       */
      {
        source: "/tienda/:categoria/",
        destination: "/:categoria/",
        statusCode: 301,
      },
    ];
  },

  async headers() {
    /**
     * Content-Security-Policy.
     *
     * `script-src-attr 'none'` bloquea los manejadores de evento en línea
     * (onerror=, onclick=) sin tocar los <script> de bloque. Es la red que
     * atrapa un XSS almacenado aunque el sanitizador de descripciones falle:
     * el `<img onerror=...>` no ejecuta. Los <script> sí se permiten con
     * 'unsafe-inline' porque el JSON-LD de datos estructurados y el arranque
     * de Next van en línea y no hay nonce (haría falta middleware).
     *
     * En desarrollo se añade 'unsafe-eval': React Refresh / HMR lo usan y sin
     * él la consola se llena de errores de CSP y el recargado en caliente cae.
     */
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      // googletagmanager.com: el contenedor GTM y el loader de gtag (GA4) se
      // cargan desde ahí. Sin este origen, script-src caía a 'self' y el
      // navegador bloqueaba las DOS etiquetas en silencio —"Loading the
      // script ... violates ... script-src". No es un error del contenedor
      // ni del consentimiento: nunca llegaron a ejecutarse, aunque el <script>
      // ya estuviera insertado en el DOM.
      `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${dev ? " 'unsafe-eval'" : ""}`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Beacons de medición. La primera pasada de esta lista dejaba pasar el
      // SCRIPT (gtm.js, gtag/js cargaban) pero seguía bloqueando el envío de
      // datos: Consent Mode manda su señal a google.com/ccm/collect, y GA4 con
      // el linker de conversiones activo reporta también a
      // stats.g.doubleclick.net y ad.doubleclick.net, no solo a
      // googleads.g.doubleclick.net. Confirmado en la consola del navegador
      // contra producción: sin estos tres, el contenedor se inicializaba
      // (dataLayer con gtm.js/gtm.dom/gtm.load) pero cada evento moría en el
      // fetch con el mismo silencio que el script bloqueado.
      "connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://*.google-analytics.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://stats.g.doubleclick.net https://ad.doubleclick.net https://www.google.com",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          // Traefik ya aplica las cabeceras principales, pero se repiten aquí
          // para que la aplicación sea segura incluso si se sirve sin el proxy.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // HSTS: dos años, subdominios incluidos. SIN preload (el preload es
          // irreversible y solo se envía con decisión explícita). Traefik ya
          // manda esta cabecera; se repite para que la app sea segura sin el
          // proxy, con el mismo criterio.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      {
        // Las imágenes de producto cambian poco; se cachean agresivamente.
        source: "/uploads/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
