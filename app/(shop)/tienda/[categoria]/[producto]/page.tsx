import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { MessageCircle, Truck } from "lucide-react";

import { Galeria } from "@/components/producto/galeria";
import { AgregarAlCarrito } from "@/components/producto/agregar-al-carrito";
import { RejillaProductos } from "@/components/producto/tarjeta-producto";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DatosMigas, DatosProducto } from "@/components/seo/datos-estructurados";
import {
  buscarProducto,
  destinoDeProductoRetirado,
  listarRelacionados,
  listarRutasProducto,
} from "@/lib/data/catalogo";
import { formatearCOP } from "@/lib/formato";
import { metadatosDePagina } from "@/lib/seo";
import { SITIO, enlaceWhatsapp } from "@/lib/sitio";
import { leerConfigTienda } from "@/lib/data/tienda";
import { TIENDA } from "@/tienda.config";

// Las fichas que no se prerenderizaron se generan en la primera visita y
// quedan cacheadas una hora.
export const revalidate = 3600;

type Props = {
  params: Promise<{ categoria: string; producto: string }>;
};

/**
 * Prerenderiza las fichas en el build.
 *
 * El build corre en GitHub Actions, donde la base de datos de producción NO es
 * alcanzable: vive en una red privada del VPS. Si no hay conexión se devuelve
 * una lista vacía y cada ficha se genera bajo demanda en la primera visita y
 * queda cacheada. La alternativa —fallar el build— dejaría sin desplegar por
 * un motivo que no es un error del código.
 */
export async function generateStaticParams() {
  try {
    const rutas = await listarRutasProducto();
    return rutas.map((r) => ({
      categoria: r.slugCategoria,
      producto: r.slugProducto,
    }));
  } catch {
    console.warn(
      "[build] Sin acceso a la base de datos: las fichas de producto se generarán bajo demanda.",
    );
    return [];
  }
}

/** Corta en el último espacio antes del límite: nunca parte una palabra. */
function recortar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.slice(0, limite);
  const espacio = corte.lastIndexOf(" ");
  return `${corte.slice(0, espacio > 40 ? espacio : limite).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { producto: slug } = await params;
  const producto = await buscarProducto(slug);

  if (!producto) return { title: "Producto no encontrado" };

  /**
   * Título ≤ ~60 caracteres CONTANDO la marca que añade el template del
   * layout (" · " + el nombre de la tienda). El sufijo de tienda.config.ts
   * (`seo.sufijoProducto`) solo entra si cabe con ese descuento; si no cabe,
   * o la tienda no configuró sufijo, el título es el nombre solo.
   */
  const sufijo = TIENDA.seo.sufijoProducto;
  const conSufijo = sufijo ? `${producto.nombre} ${sufijo}` : producto.nombre;
  const limite = 60 - " · ".length - SITIO.nombre.length;
  const titulo =
    producto.seoTitulo ?? (sufijo && conSufijo.length <= limite ? conSufijo : producto.nombre);

  /**
   * La descripción real del producto primero; la coletilla, después.
   *
   * Antes las fichas compartían la misma plantilla "«Nombre» por «precio».
   * Domicilio el mismo día…": casi idéntica en todas. Google reescribe
   * snippets así, y cuando no lo hace muestra resultados que se leen iguales.
   * Además el precio incrustado se queda viejo en cuanto sube, y ese dato ya
   * viaja en el Offer del JSON-LD, que Google lee sin caché.
   */
  const resumen = (producto.descripcion ?? "").replace(/\s+/g, " ").trim();
  const coletilla = "Entrega a domicilio.";
  const descripcion =
    producto.seoDescripcion ??
    (resumen.length > 0
      ? `${recortar(resumen, 120)} ${coletilla}`
      : `${producto.nombre}. ${coletilla}`);

  return metadatosDePagina({
    titulo,
    descripcion,
    ruta: producto.ruta,
    imagen: producto.imagen
      ? { url: producto.imagen.url, alt: producto.imagen.alt }
      : undefined,
  });
}

export default async function FichaProducto({ params }: Props) {
  const { categoria: slugCategoria, producto: slugProducto } = await params;
  const producto = await buscarProducto(slugProducto);

  /**
   * Sin producto publicado en esa dirección hay dos casos muy distintos, y
   * tratarlos igual cuesta posicionamiento:
   *
   *   - El producto EXISTE pero se retiró (archivado, o sin variante
   *     vendible). La dirección lleva tiempo indexada y con enlaces: se
   *     redirige 301 a su categoría, que conserva la autoridad y deja al
   *     visitante donde hay algo parecido.
   *   - No existe nada con ese slug: 404, que es la verdad.
   */
  if (!producto) {
    const destino = await destinoDeProductoRetirado(slugProducto);
    if (destino) permanentRedirect(destino);
    notFound();
  }

  /**
   * La URL tiene que coincidir con la categoría real del producto.
   *
   * Antes esto devolvía 404. Ahora redirige a la ruta correcta, y es mejor por
   * dos motivos:
   *
   *   1. Recategorizar un producto desde el panel cambia su URL pública. Con
   *      404 la dirección indexada moría en el acto; con 301 la autoridad pasa
   *      a la nueva sin que haga falta desplegar nada ni mantener una tabla de
   *      redirecciones aparte.
   *   2. Sigue sin haber contenido duplicado: solo una ruta responde 200 y las
   *      demás apuntan a ella, que es justo lo que un canónico busca.
   */
  if (producto.categoria?.slug !== slugCategoria) {
    permanentRedirect(producto.ruta);
  }

  const [relacionados, envio] = await Promise.all([
    listarRelacionados(producto.id, producto.categoria?.slug ?? null),
    leerConfigTienda(),
  ]);
  const categoria = producto.categoria;
  const whatsapp = enlaceWhatsapp(producto.nombre);

  const migas = [
    { nombre: "Inicio", ruta: "/" },
    { nombre: "Tienda", ruta: "/tienda/" },
    ...(categoria ? [{ nombre: categoria.nombre, ruta: `/${categoria.slug}/` }] : []),
    { nombre: producto.nombre, ruta: producto.ruta },
  ];

  return (
    <>
      <DatosProducto producto={producto} envio={envio} />
      <DatosMigas migas={migas} />

      <div className="mx-auto max-w-6xl px-4 py-10">
        <nav aria-label="Ruta de navegación">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {migas.map((m, i) => (
              <li key={m.ruta} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                {i === migas.length - 1 ? (
                  <span aria-current="page" className="text-foreground">
                    {m.nombre}
                  </span>
                ) : (
                  <Link href={m.ruta} className="transition-colors hover:text-foreground">
                    {m.nombre}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Galeria fotos={producto.imagenes} nombre={producto.nombre} />

          <div>
            {categoria && (
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
                {categoria.nombre}
              </p>
            )}

            <h1 className="display mt-3 text-3xl md:text-4xl">{producto.nombre}</h1>

            <div className="mt-5 flex flex-wrap items-baseline gap-3">
              <p className="cifra text-4xl">{formatearCOP(producto.precioCop)}</p>
              {producto.precioAntesCop && (
                <p className="cifra text-xl line-through text-muted-foreground">
                  {formatearCOP(producto.precioAntesCop)}
                </p>
              )}
            </div>

            {/* El verde significa "disponible" en todo el sitio: el aviso de
                agotado va en neutro para no decir dos cosas a la vez. */}
            <p
              className={`mt-4 inline-flex items-center gap-2 text-sm font-medium ${
                producto.disponible ? "text-[var(--disponible)]" : "text-muted-foreground"
              }`}
            >
              <Truck className="size-4" aria-hidden />
              {producto.disponible ? TIENDA.producto.textoDisponible : "Agotado"}
            </p>

            <div className="mt-8">
              <AgregarAlCarrito producto={producto} />
            </div>

            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-7 py-3.5 font-medium transition-colors hover:bg-muted"
              >
                <MessageCircle className="size-5" aria-hidden />
                Preguntar por WhatsApp
              </a>
            )}

            {/* Aviso propio de la tienda (fotos ilustrativas, sustituciones,
                etc.), si lo configuró. Sin TIENDA.producto.aviso no se pinta
                nada: no todo negocio necesita esta advertencia. */}
            {TIENDA.producto.aviso && (
              <Alert className="mt-4">
                <AlertDescription>{TIENDA.producto.aviso}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        {(producto.descripcionHtml || producto.descripcion) && (
          <div className="mt-12 border-t pt-8">
            <h2 className="display text-2xl">Descripción</h2>
            {producto.descripcionHtml ? (
              <div
                className="mt-4 space-y-3 leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground [&_ul]:space-y-1.5"
                dangerouslySetInnerHTML={{ __html: producto.descripcionHtml }}
              />
            ) : (
              <p className="mt-4 leading-relaxed text-muted-foreground">
                {producto.descripcion}
              </p>
            )}
          </div>
        )}

        {relacionados.length > 0 && (
          <section className="mt-20">
            <h2 className="display text-3xl">
              Otros {categoria?.nombre.toLowerCase() ?? "productos"}
            </h2>
            <div className="mt-7">
              <RejillaProductos productos={relacionados} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
