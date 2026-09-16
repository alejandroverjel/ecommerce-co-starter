import { CONTACTO, MARCA, REDES, SITIO } from "@/lib/sitio";
import { HORA_CORTE, MUNICIPIOS } from "@/lib/validaciones/pedido";
import type { ProductoFicha } from "@/lib/data/catalogo";
import { TIENDA } from "@/tienda.config";

/**
 * Datos estructurados JSON-LD.
 *
 * Se emite un solo bloque BreadcrumbList por página, siempre: dos bloques en
 * conflicto, con rutas de categoría distintas, confunden a Google.
 */

function Bloque({ datos }: { datos: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // El contenido lo genera el servidor a partir de la base de datos, no de
      // entrada del usuario. Se escapa `<` de todos modos por si una
      // descripción de producto trae HTML.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(datos).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/** Organización y negocio local. Va solo en la portada. */
export function DatosNegocio() {
  return (
    <Bloque
      datos={{
        "@context": "https://schema.org",
        "@graph": [
          /**
           * UN solo nodo para el negocio, no dos.
           *
           * Antes había un Organization y un LocalBusiness con el mismo nombre
           * y el mismo teléfono, sin nada que los relacionara: Google no podía
           * saber que eran la misma entidad y ninguno de los dos llevaba logo.
           * Con los dos tipos en el mismo @id, las señales (redes, logo,
           * horario, zona) se acumulan sobre una sola entidad.
           */
          {
            "@type": ["Organization", "LocalBusiness"],
            "@id": `${SITIO.dominio}/#organizacion`,
            name: SITIO.nombre,
            description: SITIO.descripcion,
            url: SITIO.dominio,
            ...(CONTACTO.telefonoInternacional ? { telephone: CONTACTO.telefonoInternacional } : {}),
            email: CONTACTO.correo,
            ...(REDES.length > 0 ? { sameAs: REDES.map((r) => r.url) } : {}),
            ...(MARCA.logo
              ? { logo: { "@type": "ImageObject", url: `${SITIO.dominio}${MARCA.logo}` } }
              : {}),
            ...(MARCA.compartir ? { image: `${SITIO.dominio}${MARCA.compartir}` } : {}),
            ...(TIENDA.seo.priceRange ? { priceRange: TIENDA.seo.priceRange } : {}),
            currenciesAccepted: SITIO.moneda,
            address: {
              "@type": "PostalAddress",
              addressLocality: SITIO.ciudad,
              addressRegion: SITIO.departamento,
              addressCountry: SITIO.pais,
            },
            // Los MISMOS municipios que valida el checkout: la zona declarada
            // a los buscadores no puede prometer más de lo que el formulario
            // acepta.
            areaServed: MUNICIPIOS.map((m) => ({ "@type": "City", name: m })),
            /**
             * ATENCIÓN, no entrega. Son dos horarios distintos: este bloque es
             * el horario en que se atiende (el mismo que muestra
             * /contactenos/). Los días en que se ENTREGA van en `businessDays`
             * de `shippingDetails`, más abajo, que es el campo que Google lee
             * para los plazos de envío. Si la tienda no declaró horario de
             * atención, se omite el bloque entero.
             */
            ...(TIENDA.horarioAtencion.length > 0
              ? {
                  openingHoursSpecification: TIENDA.horarioAtencion.map((h) => ({
                    "@type": "OpeningHoursSpecification",
                    dayOfWeek: h.dias,
                    opens: h.abre,
                    closes: h.cierra,
                  })),
                }
              : {}),
          },
          {
            "@type": "WebSite",
            "@id": `${SITIO.dominio}/#sitio`,
            url: SITIO.dominio,
            name: SITIO.nombre,
            inLanguage: SITIO.idioma,
            publisher: { "@id": `${SITIO.dominio}/#organizacion` },
            // Sin SearchAction: apuntaba a /tienda/?q=, que robots.txt bloquea
            // (contradicción directa), y Google retiró la caja de búsqueda de
            // sitelinks en 2024 — hoy es marcado muerto.
          },
        ],
      }}
    />
  );
}

/**
 * Producto con su oferta.
 *
 * Este bloque es lo que clasifica la página como producto de cara a Google.
 *
 * El `og:type` de la ficha sigue siendo "website" y no "product": Next 16
 * rechaza ese valor en ejecución y descartaría TODAS las etiquetas Open Graph
 * (ver el comentario en lib/seo.ts). Da igual para los resultados
 * enriquecidos, que se leen de aquí. Lo que nunca debe emitirse es "article".
 */
export function DatosProducto({
  producto,
  envio,
}: {
  producto: ProductoFicha;
  /** Solo el costo plano: el umbral de envío gratis no cabe en este marcado. */
  envio: { envioPlanoCop: number };
}) {
  const url = `${SITIO.dominio}${producto.ruta}`;

  return (
    <Bloque
      datos={{
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": `${url}#producto`,
        name: producto.nombre,
        description: producto.seoDescripcion ?? producto.descripcion ?? producto.nombre,
        image: producto.imagenes.map((i) => new URL(i.url, SITIO.dominio).toString()),
        ...(producto.sku ? { sku: producto.sku } : {}),
        brand: { "@type": "Brand", name: SITIO.nombre },
        /**
         * Google exige un identificador junto a `brand` —gtin o mpn—, no basta
         * con la marca sola ("No se ha proporcionado ningún identificador
         * internacional, como el GTIN o la marca", Search Console). No hay
         * GTIN: son piezas armadas por la tienda, no productos de fábrica con
         * código de barras. El SKU interno cumple el mismo papel que un MPN
         * (identifica la referencia dentro de esta marca) para quien lo tenga.
         */
        ...(producto.sku ? { mpn: producto.sku } : {}),
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: SITIO.moneda,
          price: producto.precioCop,
          /**
           * Desde cuándo rige ESTA oferta (precio y condiciones). No hay
           * columna de fecha de publicación; `actualizado` es la fecha real en
           * que estos términos quedaron como están —cambiar el precio también
           * la actualiza—, así que es una fecha verdadera y no inventada.
           */
          validFrom: producto.actualizado.toISOString(),
          /**
           * `valueAddedTaxIncluded: true` = "sobre este precio no se suma
           * nada más", que es exactamente lo que pasa en el checkout.
           *
           * Antes decía `false` con la intención contraria: el comentario
           * razonaba que, como el negocio no cobra IVA, el impuesto "no está
           * incluido". Pero en schema.org `false` significa que el IVA se
           * suma aparte, así que el marcado prometía un total mayor que el
           * que se cobra. Con la tarifa de impuesto en 0, el precio mostrado
           * ya es el final y el valor honesto es `true`.
           */
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: producto.precioCop,
            priceCurrency: SITIO.moneda,
            valueAddedTaxIncluded: true,
          },
          availability: producto.disponible
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          /**
           * Autocontenido, sin @id colgado: este bloque referenciaba
           * `#organizacion`, un nodo que solo existe en la PORTADA. En la
           * ficha la referencia apuntaba al vacío y los validadores la
           * descartaban — y con ella, el vendedor de la oferta.
           */
          seller: {
            "@type": "Organization",
            "@id": `${SITIO.dominio}/#organizacion`,
            name: SITIO.nombre,
            url: SITIO.dominio,
          },
          /**
           * `TIENDA.legal.exceptuaRetracto` decide cuál de las dos figuras
           * declarar: si la tienda exceptúa el derecho de retracto (productos
           * perecederos o personalizados, Ley 1480 art. 47), se declara SIN
           * ventana de devolución. Si no lo exceptúa, se declara la ventana
           * real en días hábiles (`plazoReembolsoDiasHabiles`).
           */
          hasMerchantReturnPolicy: TIENDA.legal.exceptuaRetracto
            ? {
                "@type": "MerchantReturnPolicy",
                applicableCountry: "CO",
                returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
                merchantReturnLink: `${SITIO.dominio}/politica-de-devoluciones/`,
              }
            : {
                "@type": "MerchantReturnPolicy",
                applicableCountry: "CO",
                returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
                merchantReturnDays: TIENDA.legal.plazoReembolsoDiasHabiles,
                merchantReturnLink: `${SITIO.dominio}/politica-de-devoluciones/`,
              },
          /**
           * `shippingRate` es un MonetaryAmount con el costo plano, y punto.
           *
           * Search Console rechazó la versión anterior: "El tipo de objeto del
           * campo shippingRate no es válido". Se había puesto un
           * DeliveryChargeSpecification con `eligibleTransactionVolume` para
           * expresar el umbral de envío gratis —pero ese campo solo acepta
           * MonetaryAmount (value + currency)—. Google NO tiene forma válida en
           * OfferShippingDetails de condicionar el envío gratis al valor del
           * pedido; ese umbral se maneja en Merchant Center, no en el marcado.
           * Aquí va el costo por defecto —el que aplica a la mayoría de los
           * pedidos— y el umbral de envío gratis se dice en la página, la FAQ
           * y llms.txt, que es donde un cliente y un asistente sí lo leen.
           *
           * El destino es el departamento configurado, no "CO": prometer envío a toda Colombia es
           * mentira que el checkout desmiente. Solo los municipios que el
           * formulario acepta (`MUNICIPIOS`).
           */
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingRate: {
              "@type": "MonetaryAmount",
              value: envio.envioPlanoCop,
              currency: SITIO.moneda,
            },
            shippingDestination: {
              "@type": "DefinedRegion",
              addressCountry: SITIO.pais,
              addressRegion: SITIO.departamento,
            },
            deliveryTime: {
              "@type": "ShippingDeliveryTime",
              /**
               * `cutoffTime` es HORA_CORTE (lib/validaciones/pedido.ts): la
               * hora de corte más tardía entre las franjas configuradas, la
               * MISMA que usa el checkout para decidir si hoy todavía admite
               * un pedido. Antes esto se declaraba con la hora de CIERRE, que
               * no es la de corte y prometía una entrega que la operación no
               * podía cumplir.
               */
              handlingTime: {
                "@type": "QuantitativeValue",
                minValue: TIENDA.entregas.tiempoPreparacionDias[0],
                maxValue: TIENDA.entregas.tiempoPreparacionDias[1],
                unitCode: "DAY",
              },
              transitTime: {
                "@type": "QuantitativeValue",
                minValue: TIENDA.entregas.tiempoTransitoDias[0],
                maxValue: TIENDA.entregas.tiempoTransitoDias[1],
                unitCode: "DAY",
              },
              cutoffTime: `${HORA_CORTE}:00-05:00`,
              businessDays: {
                "@type": "OpeningHoursSpecification",
                dayOfWeek: TIENDA.entregas.diasEntrega,
              },
            },
          },
        },
      }}
    />
  );
}

/** Migas de pan. UN solo bloque por página. */
export function DatosMigas({
  migas,
}: {
  migas: { nombre: string; ruta: string }[];
}) {
  return (
    <Bloque
      datos={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: migas.map((m, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: m.nombre,
          item: `${SITIO.dominio}${m.ruta}`,
        })),
      }}
    />
  );
}

/** Listado de categoría. */
export function DatosColeccion({
  nombre,
  descripcion,
  ruta,
  productos,
}: {
  nombre: string;
  descripcion: string;
  ruta: string;
  productos: {
    nombre: string;
    ruta: string;
    precioCop?: number;
    imagen?: { url: string } | null;
    disponible?: boolean;
  }[];
}) {
  return (
    <Bloque
      datos={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${SITIO.dominio}${ruta}#coleccion`,
        name: nombre,
        description: descripcion,
        url: `${SITIO.dominio}${ruta}`,
        inLanguage: SITIO.idioma,
        isPartOf: { "@id": `${SITIO.dominio}/#sitio` },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: productos.length,
          /**
           * Cada elemento lleva el Product dentro, no solo el nombre y la URL.
           *
           * La página ya pinta foto y precio de los 16 productos; sin `item`
           * el listado no es elegible para el carrusel de productos de Google,
           * que es justo lo que una página de categoría puede ganar.
           */
          itemListElement: productos.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "Product",
              name: p.nombre,
              url: `${SITIO.dominio}${p.ruta}`,
              ...(p.imagen
                ? { image: new URL(p.imagen.url, SITIO.dominio).toString() }
                : {}),
              ...(typeof p.precioCop === "number"
                ? {
                    offers: {
                      "@type": "Offer",
                      url: `${SITIO.dominio}${p.ruta}`,
                      price: p.precioCop,
                      priceCurrency: SITIO.moneda,
                      availability:
                        p.disponible === false
                          ? "https://schema.org/OutOfStock"
                          : "https://schema.org/InStock",
                    },
                  }
                : {}),
            },
          })),
        },
      }}
    />
  );
}

/**
 * Preguntas frecuentes (FAQPage).
 *
 * Es el bloque que más citan los motores de respuesta —AI Overviews de Google,
 * ChatGPT, Perplexity—: pregunta y respuesta literales, listas para extraer.
 * Va SOLO en /contactenos/, que es donde las preguntas se muestran de verdad:
 * marcar FAQs que la página no contiene es motivo de acción manual.
 */
export function DatosPreguntas({
  preguntas,
}: {
  preguntas: readonly { p: string; r: string }[];
}) {
  return (
    <Bloque
      datos={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: preguntas.map((f) => ({
          "@type": "Question",
          name: f.p,
          acceptedAnswer: { "@type": "Answer", text: f.r },
        })),
      }}
    />
  );
}
