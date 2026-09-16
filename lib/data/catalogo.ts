import "server-only";

import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  categories,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { TIENDA } from "@/tienda.config";

/**
 * Capa de acceso al catálogo.
 *
 * Es la costura del proyecto: las páginas y los componentes SOLO importan de
 * aquí, nunca de Drizzle directamente. Si algún día cambia el motor o el
 * schema, se reescribe este archivo y el resto del sitio no se entera.
 *
 * Todas las funciones devuelven tipos planos y ya calculados (precio, imagen
 * principal, disponibilidad), para que los componentes no tengan que saber
 * que el precio vive en la variante y no en el producto.
 */

/** Producto tal como lo consume la interfaz. */
export type ProductoLista = {
  id: string;
  slug: string;
  nombre: string;
  /** Precio de venta en pesos enteros. Ya incluye IVA. */
  precioCop: number;
  /** Precio tachado, si el producto está en oferta. */
  precioAntesCop: number | null;
  disponible: boolean;
  destacado: boolean;
  categoria: { slug: string; nombre: string } | null;
  imagen: { url: string; alt: string } | null;
  /** Ruta canónica. Debe coincidir con la que ya está indexada. */
  ruta: string;
};

export type ProductoFicha = ProductoLista & {
  descripcion: string | null;
  descripcionHtml: string | null;
  sku: string | null;
  imagenes: { url: string; alt: string; ancho: number | null; alto: number | null }[];
  variantes: {
    id: string;
    nombre: string;
    precioCop: number;
    disponible: boolean;
  }[];
  seoTitulo: string | null;
  seoDescripcion: string | null;
  actualizado: Date;
};

export type Categoria = {
  slug: string;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  cuantosProductos: number;
};

/**
 * Etiqueta de caché de todo lo que lee el catálogo (productos y categorías).
 * El panel la invalida (`revalidateTag`) al guardar o retirar un producto, así
 * que ninguna vista en caché muestra un precio o una categoría vieja.
 */
export const ETIQUETA_CATALOGO = "catalogo";

/**
 * Construye la ruta de un producto.
 *
 * CRÍTICO PARA EL SEO: el formato `/tienda/{categoria}/{producto}/` es el que
 * queda indexado. La barra final es obligatoria (`trailingSlash`).
 */
export function rutaProducto(slugCategoria: string | null, slugProducto: string): string {
  // Un producto sin categoría no debería existir en producción, pero si pasa,
  // colgarlo de /tienda/ es preferible a generar una ruta rota.
  if (!slugCategoria) return `/tienda/${slugProducto}/`;
  return `/tienda/${slugCategoria}/${slugProducto}/`;
}

/**
 * Subconsulta: la variante activa más barata de cada producto.
 *
 * El schema pone precio y stock en las variantes, no en el producto. Para
 * listar hace falta una sola cifra por producto, y la convención de la tienda
 * es mostrar "desde" el precio menor.
 */
const varianteRepresentativa = db
  .select({
    productId: productVariants.productId,
    precioCop: sql<number>`min(${productVariants.priceCop})`.as("precio_cop"),
    hayStock: sql<boolean>`bool_or(${productVariants.stock} > 0)`.as("hay_stock"),
  })
  .from(productVariants)
  .where(eq(productVariants.isActive, true))
  .groupBy(productVariants.productId)
  .as("variante");

/** Subconsulta: la imagen de menor `position` de cada producto. */
const imagenPrincipal = db
  .selectDistinctOn([productImages.productId], {
    productId: productImages.productId,
    url: productImages.url,
    altText: productImages.altText,
  })
  .from(productImages)
  .orderBy(productImages.productId, asc(productImages.position))
  .as("imagen");

const SELECCION_LISTA = {
  id: products.id,
  slug: products.slug,
  nombre: products.name,
  destacado: products.isFeatured,
  posicion: products.position,
  precioCop: varianteRepresentativa.precioCop,
  hayStock: varianteRepresentativa.hayStock,
  categoriaSlug: categories.slug,
  categoriaNombre: categories.name,
  imagenUrl: imagenPrincipal.url,
  imagenAlt: imagenPrincipal.altText,
};

type FilaLista = {
  id: string;
  slug: string;
  nombre: string;
  destacado: boolean;
  precioCop: number | null;
  hayStock: boolean | null;
  categoriaSlug: string | null;
  categoriaNombre: string | null;
  imagenUrl: string | null;
  imagenAlt: string | null;
};

function aProductoLista(f: FilaLista): ProductoLista {
  return {
    id: f.id,
    slug: f.slug,
    nombre: f.nombre,
    precioCop: f.precioCop ?? 0,
    precioAntesCop: null,
    disponible: f.hayStock ?? false,
    destacado: f.destacado,
    categoria: f.categoriaSlug
      ? { slug: f.categoriaSlug, nombre: f.categoriaNombre ?? f.categoriaSlug }
      : null,
    imagen: f.imagenUrl ? { url: f.imagenUrl, alt: f.imagenAlt ?? f.nombre } : null,
    ruta: rutaProducto(f.categoriaSlug, f.slug),
  };
}

/** Solo productos publicados. Los borradores y archivados nunca salen. */
const soloActivos = eq(products.status, "activo");

/**
 * A dónde mandar la dirección de un producto que ya no se publica.
 *
 * Un producto archivado suele llevar meses o años indexado y con enlaces
 * apuntándole. Responder 404 tira todo eso a la basura de golpe; un 301 a su
 * categoría conserva la autoridad y además deja al visitante donde puede
 * encontrar algo parecido, que es lo que venía buscando.
 *
 * Devuelve la ruta de la categoría, o `null` si el producto no existe (ahí sí
 * corresponde 404: nunca hubo nada en esa dirección).
 */
export async function destinoDeProductoRetirado(slug: string): Promise<string | null> {
  const [fila] = await db
    .select({ slugCategoria: categories.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.slug, slug))
    .limit(1);

  if (!fila) return null;
  return fila.slugCategoria ? `/${fila.slugCategoria}/` : "/tienda/";
}

/** Cómo ordena la tienda. Por precio para el filtro; "curado" es destacados
 *  primero y es el que declara `tienda.config.ts` como orden por defecto. */
export type OrdenTienda = "precio-asc" | "precio-desc" | "curado";

/** Columnas de ORDER BY para cada OrdenTienda, compartidas por las dos
 *  funciones de abajo para no tener dos veces la misma traducción. */
function ordenPor(orden: OrdenTienda) {
  if (orden === "precio-asc") return [asc(varianteRepresentativa.precioCop), asc(products.name)];
  if (orden === "precio-desc") return [desc(varianteRepresentativa.precioCop), asc(products.name)];
  return [desc(products.isFeatured), asc(products.position), asc(products.name)];
}

/** Todos los productos de la tienda. */
export async function listarProductos(opciones?: {
  limite?: number;
  /** Slug de categoría para filtrar. Vacío = todo el catálogo. */
  categoria?: string;
  orden?: OrdenTienda;
}): Promise<ProductoVitrina[]> {
  const filtros = [soloActivos];
  if (opciones?.categoria) filtros.push(eq(categories.slug, opciones.categoria));

  const consulta = db
    .select(SELECCION_VITRINA)
    .from(products)
    // innerJoin, no leftJoin: un producto sin categoría no tiene ruta pública
    // válida (rutaProducto cae a /tienda/{slug}/, que la redirección de
    // /tienda/:categoria/ manda a un 404). Mostrarlo en la vitrina sería
    // enlazar a una página rota.
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(varianteRepresentativa, eq(varianteRepresentativa.productId, products.id))
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(and(...filtros))
    .orderBy(...ordenPor(opciones?.orden ?? "curado"));

  const filas = opciones?.limite ? await consulta.limit(opciones.limite) : await consulta;
  return filas.map(aProductoVitrina);
}

/** Productos de una categoría, en el orden por defecto de la tienda. */
export async function listarProductosDeCategoria(
  slugCategoria: string,
): Promise<ProductoVitrina[]> {
  const filas = await db
    .select(SELECCION_VITRINA)
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(varianteRepresentativa, eq(varianteRepresentativa.productId, products.id))
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(and(soloActivos, eq(categories.slug, slugCategoria)))
    .orderBy(...ordenPor(TIENDA.catalogo.ordenPorDefecto));

  return filas.map(aProductoVitrina);
}

/** Productos marcados a mano como destacados. En caché: la invalida el panel al guardar. */
async function consultarDestacados(limite = 8): Promise<ProductoLista[]> {
  const filas = await db
    .select(SELECCION_LISTA)
    .from(products)
    // innerJoin: ver el comentario de listarProductos. Un producto sin
    // categoría no tiene ruta pública, así que no puede ser destacado.
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(varianteRepresentativa, eq(varianteRepresentativa.productId, products.id))
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(and(soloActivos, eq(products.isFeatured, true)))
    .orderBy(asc(products.position), asc(products.name))
    .limit(limite);

  return filas.map(aProductoLista);
}

export const listarDestacados = unstable_cache(consultarDestacados, ["destacados"], {
  revalidate: 3600,
  tags: [ETIQUETA_CATALOGO],
});

/**
 * Complementos para el cross-sell del carrito ("Completa tu compra").
 *
 * A diferencia de los tipos de lista, TRAE el varianteId: el carrito agrega
 * directo, sin pasar por la ficha, y hacerlo con varianteId null dejaría dos
 * líneas de la misma variante (el bug de agrupación del checkout). Aquí se
 * agrega la variante concreta, sin ambigüedad.
 *
 * El candidato sale de `TIENDA.catalogo.categoriasCrossSell`: la idea es sumar
 * un detalle pequeño al pedido, así que cada tienda decide de qué categorías
 * conviene sugerir. Vacío = sin filtro de categoría, y gana lo más barato de
 * todo el catálogo activo.
 */
export type ProductoComplemento = {
  productoId: string;
  varianteId: string;
  slug: string;
  nombre: string;
  precioCop: number;
  imagenUrl: string | null;
  ruta: string;
};

export async function listarComplementos(limite = 8): Promise<ProductoComplemento[]> {
  /**
   * La variante activa más barata CON su id. `varianteRepresentativa` no sirve
   * aquí porque hace min(precio) agregado y pierde el id de la fila; con
   * distinctOn se conserva la variante concreta.
   */
  const varianteBarata = db
    .selectDistinctOn([productVariants.productId], {
      productId: productVariants.productId,
      varianteId: productVariants.id,
      precioCop: productVariants.priceCop,
      stock: productVariants.stock,
    })
    .from(productVariants)
    .where(eq(productVariants.isActive, true))
    .orderBy(productVariants.productId, asc(productVariants.priceCop))
    .as("variante_barata");

  const filas = await db
    .select({
      productoId: products.id,
      varianteId: varianteBarata.varianteId,
      slug: products.slug,
      nombre: products.name,
      precioCop: varianteBarata.precioCop,
      categoriaSlug: categories.slug,
      imagenUrl: imagenPrincipal.url,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(
      varianteBarata,
      and(eq(varianteBarata.productId, products.id), gt(varianteBarata.stock, 0)),
    )
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(
      and(
        soloActivos,
        TIENDA.catalogo.categoriasCrossSell.length > 0
          ? inArray(categories.slug, TIENDA.catalogo.categoriasCrossSell)
          : undefined,
      ),
    )
    .orderBy(asc(varianteBarata.precioCop))
    .limit(limite);

  return filas.map((f) => ({
    productoId: f.productoId,
    varianteId: f.varianteId,
    slug: f.slug,
    nombre: f.nombre,
    precioCop: f.precioCop,
    imagenUrl: f.imagenUrl,
    ruta: rutaProducto(f.categoriaSlug, f.slug),
  }));
}

/** Producto de lista con un extracto de la descripción, para las vitrinas grandes de portada. */
export type ProductoVitrina = ProductoLista & {
  extracto: string | null;
};

const SELECCION_VITRINA = {
  ...SELECCION_LISTA,
  descripcion: products.description,
};

/** Corta la descripción en el espacio más cercano a 110 caracteres, sin partir palabras. */
function aExtracto(descripcion: string | null): string | null {
  if (!descripcion) return null;
  const plano = descripcion.trim();
  if (plano.length <= 110) return plano;
  const corte = plano.slice(0, 110);
  const ultimoEspacio = corte.lastIndexOf(" ");
  return `${corte.slice(0, ultimoEspacio > 0 ? ultimoEspacio : 110).trimEnd()}…`;
}

function aProductoVitrina(f: FilaLista & { descripcion: string | null }): ProductoVitrina {
  return { ...aProductoLista(f), extracto: aExtracto(f.descripcion) };
}

/**
 * Ficha completa de un producto.
 *
 * Se busca por slug, no por id: el slug es lo que viene en la URL indexada.
 * Devuelve `null` si no existe o no está publicado, para que la página
 * responda 404 en vez de reventar.
 */
export async function buscarProducto(slug: string): Promise<ProductoFicha | null> {
  const fila = await db.query.products.findFirst({
    where: and(soloActivos, eq(products.slug, slug)),
    with: {
      category: true,
      images: { orderBy: (i, { asc }) => [asc(i.position)] },
      variants: {
        where: (v, { eq }) => eq(v.isActive, true),
        orderBy: (v, { asc }) => [asc(v.position), asc(v.priceCop)],
      },
    },
  });

  if (!fila) return null;

  const variantesActivas = fila.variants ?? [];

  // Producto activo sin NINGUNA variante activa: no se puede comprar. Antes se
  // publicaba a "$ 0" en la ficha, la metadata y el JSON-LD. Se trata como
  // inexistente (404) hasta que tenga una variante vendible.
  if (variantesActivas.length === 0) return null;

  // Precio "desde": el menor entre las variantes CON stock. Si ninguna tiene,
  // se cae a todas las activas (para no mostrar vacío), pero `disponible` será
  // false. Antes tomaba el mínimo incluyendo agotadas, así que anunciaba un
  // precio más barato que el que el checkout iba a cobrar.
  const conStock = variantesActivas.filter((v) => v.stock > 0);
  const base = conStock.length > 0 ? conStock : variantesActivas;
  const precioCop = Math.min(...base.map((v) => v.priceCop));

  // El precio tachado solo se muestra si de verdad es mayor: un
  // compare_at_price igual o menor al precio no es una oferta, es ruido.
  const varianteBarata = base.find((v) => v.priceCop === precioCop);
  const precioAntesCop =
    varianteBarata?.compareAtPriceCop && varianteBarata.compareAtPriceCop > precioCop
      ? varianteBarata.compareAtPriceCop
      : null;

  return {
    id: fila.id,
    slug: fila.slug,
    nombre: fila.name,
    precioCop,
    precioAntesCop,
    disponible: variantesActivas.some((v) => v.stock > 0),
    destacado: fila.isFeatured,
    categoria: fila.category
      ? { slug: fila.category.slug, nombre: fila.category.name }
      : null,
    imagen: fila.images?.[0]
      ? { url: fila.images[0].url, alt: fila.images[0].altText ?? fila.name }
      : null,
    ruta: rutaProducto(fila.category?.slug ?? null, fila.slug),
    descripcion: fila.description,
    descripcionHtml: fila.descriptionHtml,
    sku: variantesActivas[0]?.sku ?? null,
    imagenes: (fila.images ?? []).map((i) => ({
      url: i.url,
      alt: i.altText ?? fila.name,
      ancho: i.width,
      alto: i.height,
    })),
    variantes: variantesActivas.map((v) => ({
      id: v.id,
      nombre: v.name,
      precioCop: v.priceCop,
      disponible: v.stock > 0,
    })),
    seoTitulo: fila.seoTitle,
    seoDescripcion: fila.seoDescription,
    actualizado: fila.updatedAt,
  };
}

/** Productos parecidos: misma categoría, excluyendo el que se está viendo. */
export async function listarRelacionados(
  idProducto: string,
  slugCategoria: string | null,
  limite = 4,
): Promise<ProductoVitrina[]> {
  if (!slugCategoria) return [];

  /**
   * VENTANA ROTATORIA, no "los primeros 4 de la categoría".
   *
   * Antes esto ordenaba por destacado y posición y cortaba en 4, así que las
   * fichas de una categoría grande enlazaban SIEMPRE a los mismos cuatro
   * productos, y el resto del catálogo se quedaba con dos enlaces internos
   * (solo /tienda/ y su categoría). Google rastrea y reindexa menos lo que
   * casi nadie enlaza.
   *
   * Ahora cada producto enlaza a los `limite` que le siguen en la categoría,
   * dando la vuelta al llegar al final. Es determinista (misma página, mismos
   * enlaces, se puede cachear) y reparte parejo: cada ficha recibe exactamente
   * tantos enlaces de hermanas como enlaces emite.
   */
  const hermanas = await db
    .select(SELECCION_VITRINA)
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(varianteRepresentativa, eq(varianteRepresentativa.productId, products.id))
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(and(soloActivos, eq(categories.slug, slugCategoria)))
    .orderBy(asc(products.position), asc(products.name));

  const actual = hermanas.findIndex((f) => f.id === idProducto);
  // El producto no está en su propia categoría (recién archivado, por ejemplo):
  // se cae al comportamiento simple en vez de devolver una ventana rara.
  const desde = actual >= 0 ? actual : 0;

  const otras = hermanas.filter((_, i) => i !== actual);
  if (otras.length === 0) return [];

  const ventana = Array.from({ length: Math.min(limite, otras.length) }, (_, k) =>
    otras[(desde + k) % otras.length]!,
  );

  return ventana.map(aProductoVitrina);
}

/** Categorías activas con su conteo de productos publicados. En caché: la
 *  invalida el panel (ETIQUETA_CATALOGO) al guardar o retirar un producto. */
async function consultarCategorias(): Promise<Categoria[]> {
  const filas = await db
    .select({
      slug: categories.slug,
      nombre: categories.name,
      descripcion: categories.description,
      imagenUrl: categories.imageUrl,
      cuantos: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .leftJoin(products, and(eq(products.categoryId, categories.id), soloActivos))
    .where(eq(categories.isActive, true))
    .groupBy(categories.id, categories.slug, categories.name, categories.description, categories.imageUrl, categories.position)
    .orderBy(asc(categories.position), asc(categories.name));

  return filas.map((f) => ({
    slug: f.slug,
    nombre: f.nombre,
    descripcion: f.descripcion,
    imagenUrl: f.imagenUrl,
    cuantosProductos: f.cuantos,
  }));
}

export const listarCategorias = unstable_cache(consultarCategorias, ["categorias"], {
  revalidate: 3600,
  tags: [ETIQUETA_CATALOGO],
});

export async function buscarCategoriaEnDb(slug: string): Promise<Categoria | null> {
  const todas = await listarCategorias();
  return todas.find((c) => c.slug === slug) ?? null;
}

/**
 * Búsqueda por nombre y descripción.
 *
 * `ilike` con comodines basta para un catálogo chico. Si crece, migrar a
 * búsqueda de texto completo de Postgres (`tsvector`) o `pg_trgm`.
 */
export async function buscarProductos(termino: string): Promise<ProductoVitrina[]> {
  const limpio = termino.trim();
  if (limpio.length < 2) return [];

  // `%` y `_` son comodines de ilike: sin escaparlos, buscar "%%" listaba el
  // catálogo entero y "_" casaba cualquier letra. La query va parametrizada
  // (no hay inyección posible), esto es solo que el término sea texto.
  const patron = `%${limpio.replace(/[%_\\]/g, "\\$&")}%`;

  const filas = await db
    .select(SELECCION_VITRINA)
    .from(products)
    // innerJoin: ver el comentario de listarProductos. La búsqueda tampoco
    // debe enlazar a un producto sin ruta pública.
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(varianteRepresentativa, eq(varianteRepresentativa.productId, products.id))
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(
      and(
        soloActivos,
        or(ilike(products.name, patron), ilike(products.description, patron)),
      ),
    )
    .orderBy(desc(products.isFeatured), asc(products.name))
    .limit(48);

  return filas.map(aProductoVitrina);
}

/**
 * Todas las rutas de producto, para el sitemap y para `generateStaticParams`.
 */
export async function listarRutasProducto(): Promise<
  { slugCategoria: string; slugProducto: string; actualizado: Date; imagen: string | null }[]
> {
  const filas = await db
    .select({
      slugProducto: products.slug,
      slugCategoria: categories.slug,
      actualizado: products.updatedAt,
      // La foto principal, para el sitemap de imágenes: una image:loc por
      // producto, que es de lo que vive Google Imágenes.
      imagen: imagenPrincipal.url,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(imagenPrincipal, eq(imagenPrincipal.productId, products.id))
    .where(soloActivos);

  return filas.map((f) => ({
    slugCategoria: f.slugCategoria,
    slugProducto: f.slugProducto,
    actualizado: f.actualizado,
    imagen: f.imagen,
  }));
}
