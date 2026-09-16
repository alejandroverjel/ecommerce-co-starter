"use server";

import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import { auth, rolReal } from "@/auth";
import { db } from "@/lib/db";
import {
  categories,
  orderItems,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { ETIQUETA_CATALOGO, rutaProducto } from "@/lib/data/catalogo";
import { formatearCOP } from "@/lib/formato";
import { errorPg } from "@/lib/db/errores";
import { ejecutar, exigirPersonal, type ResultadoAccion } from "@/lib/admin/guardia";
import {
  campoVariante,
  esquemaCrearProducto,
  esquemaProducto,
  generarSlug,
  type CampoVariante,
  type DatosProductoEditado,
} from "@/lib/validaciones/producto";
import { limpiarHtml } from "@/lib/admin/sanitizar";

/**
 * Edición de productos y variantes.
 *
 * Server action y no ruta de API, siguiendo el patrón de lib/auth/acciones.ts.
 *
 * AUTORIZACIÓN: el layout de /admin ya comprueba el rol, pero eso protege la
 * PÁGINA, no esto. Una server action es un endpoint POST con su propio id: se
 * puede invocar desde fuera sin haber cargado nunca el panel. Por eso se
 * vuelve a comprobar aquí, y contra la base (`rolReal`) y no contra el token:
 * el rol viaja dentro del JWT y sigue diciendo "admin" hasta que el token
 * expire, siete días después de que se le quitara el permiso a la persona.
 */

// ============================================================================
// Estado del formulario
// ============================================================================

export type EstadoFormularioProducto = {
  ok?: boolean;
  /** Confirmación para mostrar arriba del formulario. */
  mensaje?: string;
  /** Fallo general: sin permiso, conflicto, error de base. */
  error?: string;
  /** Hubo edición simultánea. La interfaz ofrece recargar en vez de reintentar. */
  conflicto?: boolean;
  /** Errores por campo, con el nombre del input como llave. */
  errores?: Record<string, string>;
  /** Cosas que se hicieron y conviene contar, aunque el guardado saliera bien. */
  avisos?: string[];
  /**
   * El producto se retiró (borrado o archivado). La ficha ya no representa
   * nada editable: la interfaz esconde el formulario y ofrece volver a la
   * lista en vez de dejar campos que al guardar darían "ya no existe".
   */
  eliminado?: boolean;
};

/** Corta el flujo desde dentro de la transacción y la deja sin efecto. */
class FalloEdicion extends Error {
  constructor(readonly estado: EstadoFormularioProducto) {
    super(estado.error ?? "fallo de edición");
  }
}

// ============================================================================
// Lectura del formulario
// ============================================================================

function texto(datos: FormData, campo: string): string {
  const v = datos.get(campo);
  return typeof v === "string" ? v : "";
}

/** Un checkbox sin marcar no viaja en el FormData: ausente es `false`. */
function marcado(datos: FormData, campo: string): boolean {
  return datos.get(campo) !== null;
}

function entero(datos: FormData, campo: string): number {
  const n = Number(texto(datos, campo));
  return Number.isFinite(n) ? n : -1;
}

/**
 * Coloca cada issue de Zod debajo del input que lo produjo.
 *
 * Zod devuelve rutas como `["variantes", 2, "precioCop"]`; el formulario nombra
 * ese input `v_{idVariante}_precio`. La traducción vive aquí y en
 * `campoVariante`, en ningún otro lado.
 */
const CAMPO_ZOD_A_INPUT: Record<string, CampoVariante> = {
  nombre: "nombre",
  precioCop: "precio",
  stock: "stock",
  sku: "sku",
  activa: "activa",
};

function mapaErrores(
  issues: { path: PropertyKey[]; message: string }[],
  idsPorIndice: string[],
): Record<string, string> {
  const errores: Record<string, string> = {};

  for (const issue of issues) {
    const [primero, segundo, tercero] = issue.path;
    let llave: string;

    if (primero === "variantes" && typeof segundo === "number") {
      const id = idsPorIndice[segundo];
      const campo = CAMPO_ZOD_A_INPUT[String(tercero)];
      if (!id || !campo) continue;
      llave = campoVariante(id, campo);
    } else {
      llave = String(primero ?? "");
    }

    // El primer mensaje por campo gana: es el más específico y dos mensajes
    // debajo del mismo input se leen como ruido.
    if (llave && !errores[llave]) errores[llave] = issue.message;
  }

  return errores;
}

// ============================================================================
// Acción
// ============================================================================

export async function guardarProducto(
  _previo: EstadoFormularioProducto | undefined,
  datos: FormData,
): Promise<EstadoFormularioProducto> {
  const sesion = await auth();
  if (!sesion?.user?.id) {
    return { error: "Tu sesión se cerró. Entra otra vez y vuelve a guardar." };
  }

  const rol = await rolReal(sesion.user.id);
  if (rol !== "admin" && rol !== "staff") {
    return { error: "Tu cuenta ya no puede editar el catálogo." };
  }

  // --- Armar la entrada -----------------------------------------------------

  const idsEnviados = texto(datos, "varianteIds").split(",").filter(Boolean);

  const crudo = {
    id: texto(datos, "id"),
    version: entero(datos, "version"),
    nombre: texto(datos, "nombre"),
    descripcion: texto(datos, "descripcion"),
    descripcionHtml: texto(datos, "descripcionHtml"),
    estado: texto(datos, "estado"),
    destacado: marcado(datos, "destacado"),
    categoriaId: texto(datos, "categoriaId"),
    posicion: texto(datos, "posicion"),
    seoTitulo: texto(datos, "seoTitulo"),
    seoDescripcion: texto(datos, "seoDescripcion"),
    variantes: idsEnviados.map((id) => ({
      id,
      version: entero(datos, campoVariante(id, "version")),
      nombre: texto(datos, campoVariante(id, "nombre")),
      precioCop: texto(datos, campoVariante(id, "precio")),
      stock: texto(datos, campoVariante(id, "stock")),
      sku: texto(datos, campoVariante(id, "sku")),
      activa: marcado(datos, campoVariante(id, "activa")),
    })),
  };

  const analisis = esquemaProducto.safeParse(crudo);

  if (!analisis.success) {
    return {
      error: "Revisa los campos marcados.",
      errores: mapaErrores(analisis.error.issues, idsEnviados),
    };
  }

  const entrada: DatosProductoEditado = analisis.data;
  const avisos: string[] = [];

  // La descripción con formato se pinta con dangerouslySetInnerHTML en la
  // ficha pública: lo que no debe ejecutarse se quita antes de guardarlo, no
  // al mostrarlo.
  let htmlLimpio = entrada.descripcionHtml;
  if (htmlLimpio) {
    const { html, cambiado } = limpiarHtml(htmlLimpio);
    htmlLimpio = html.trim() === "" ? null : html;
    if (cambiado) {
      avisos.push(
        "Se quitó código no permitido de la descripción con formato (scripts, iframes o enlaces ejecutables).",
      );
    }
  }

  try {
    const efecto = await db.transaction(async (tx) => {
      /**
       * CONCURRENCIA — por qué se bloquea y se compara `updated_at`.
       *
       * Dos personas del equipo pueden tener la misma ficha abierta. Sin
       * control, la segunda en guardar pisa a la primera sin que nadie se
       * entere: el precio que quedó no es el que ninguna de las dos cree.
       *
       * Se escogió bloqueo optimista (comparar la versión que traía el
       * formulario contra la que hay en la base) en vez de pesimista (reservar
       * la ficha al abrirla) porque los conflictos son raros y una ficha
       * "tomada" por alguien que se fue a almorzar bloquea la operación.
       *
       * El `for update` de aquí NO es el control de concurrencia: es lo que
       * hace que la comparación sea fiable. Sin él, dos guardados simultáneos
       * pueden leer los dos la misma versión vieja, encontrarla correcta, y
       * escribir los dos igual. Con el bloqueo, el segundo espera, relee y ve
       * la versión nueva.
       *
       * Las variantes se bloquean ORDENADAS POR ID, la misma convención que
       * usa create_pending_order: dos transacciones que tomen los mismos
       * candados en distinto orden se abrazan en un deadlock.
       */
      const [actual] = await tx
        .select({
          id: products.id,
          slug: products.slug,
          nombre: products.name,
          descripcion: products.description,
          descripcionHtml: products.descriptionHtml,
          estado: products.status,
          destacado: products.isFeatured,
          categoriaId: products.categoryId,
          posicion: products.position,
          seoTitulo: products.seoTitle,
          seoDescripcion: products.seoDescription,
          actualizado: products.updatedAt,
        })
        .from(products)
        .where(eq(products.id, entrada.id))
        .for("update");

      if (!actual) {
        throw new FalloEdicion({ error: "Ese producto ya no existe." });
      }

      if (actual.actualizado.getTime() !== entrada.version) {
        throw new FalloEdicion({
          conflicto: true,
          error:
            "Alguien más guardó cambios en este producto mientras lo tenías abierto. " +
            "Recarga la ficha para ver lo que quedó y vuelve a aplicar lo tuyo: " +
            "así no se pierde el trabajo de nadie.",
        });
      }

      const variantesActuales = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, entrada.id))
        .orderBy(asc(productVariants.id))
        .for("update");

      // El conjunto de variantes tiene que ser el mismo que el formulario vio.
      // Si no lo es, o alguien agregó o quitó una desde otra pestaña, o el
      // POST viene de fuera con ids que no son de este producto.
      const idsBase = new Set(variantesActuales.map((v) => v.id));
      const idsForm = new Set(entrada.variantes.map((v) => v.id));
      const mismas =
        idsBase.size === idsForm.size && [...idsBase].every((id) => idsForm.has(id));

      if (!mismas) {
        throw new FalloEdicion({
          conflicto: true,
          error:
            "Las variantes de este producto cambiaron desde que abriste la ficha. " +
            "Recárgala antes de guardar.",
        });
      }

      // --- Producto ---------------------------------------------------------

      const cambiosProducto: Record<string, unknown> = {};

      if (actual.nombre !== entrada.nombre) cambiosProducto.name = entrada.nombre;
      if (actual.descripcion !== entrada.descripcion) {
        cambiosProducto.description = entrada.descripcion;
      }
      if (actual.descripcionHtml !== htmlLimpio) {
        cambiosProducto.descriptionHtml = htmlLimpio;
      }
      if (actual.estado !== entrada.estado) cambiosProducto.status = entrada.estado;
      if (actual.destacado !== entrada.destacado) {
        cambiosProducto.isFeatured = entrada.destacado;
      }
      if (actual.categoriaId !== entrada.categoriaId) {
        cambiosProducto.categoryId = entrada.categoriaId;
      }
      if (actual.posicion !== entrada.posicion) cambiosProducto.position = entrada.posicion;
      if (actual.seoTitulo !== entrada.seoTitulo) cambiosProducto.seoTitle = entrada.seoTitulo;
      if (actual.seoDescripcion !== entrada.seoDescripcion) {
        cambiosProducto.seoDescription = entrada.seoDescripcion;
      }

      if (Object.keys(cambiosProducto).length > 0) {
        await tx.update(products).set(cambiosProducto).where(eq(products.id, entrada.id));
      }

      // --- Variantes --------------------------------------------------------

      let variantesTocadas = 0;

      for (const enviada of entrada.variantes) {
        const base = variantesActuales.find((v) => v.id === enviada.id)!;

        if (base.updatedAt.getTime() !== enviada.version) {
          throw new FalloEdicion({
            conflicto: true,
            error:
              `Alguien más cambió la variante «${base.name}» mientras tenías la ficha abierta. ` +
              "Recárgala para no pisar su trabajo.",
          });
        }

        const cambios: Record<string, unknown> = {};

        if (base.name !== enviada.nombre) cambios.name = enviada.nombre;
        if (base.priceCop !== enviada.precioCop) cambios.priceCop = enviada.precioCop;
        if (base.stock !== enviada.stock) cambios.stock = enviada.stock;
        if (base.sku !== enviada.sku) cambios.sku = enviada.sku;
        if (base.isActive !== enviada.activa) cambios.isActive = enviada.activa;

        /**
         * El CHECK `product_variants_compare_price_ck` exige que el precio
         * tachado sea MAYOR que el precio de venta. Si se sube el precio por
         * encima del "antes", la promoción dejó de existir, y guardar sin
         * tocarla reventaría con un error de restricción que no le dice nada a
         * quien está cambiando un precio. Se retira y se avisa: callarlo sería
         * peor que el error.
         */
        if (
          base.compareAtPriceCop !== null &&
          enviada.precioCop >= base.compareAtPriceCop
        ) {
          cambios.compareAtPriceCop = null;
          avisos.push(
            `«${base.name}»: se quitó el precio tachado de ${formatearCOP(base.compareAtPriceCop)} ` +
              "porque el precio nuevo lo alcanza. Ya no aparece como oferta.",
          );
        }

        if (Object.keys(cambios).length > 0) {
          variantesTocadas++;
          await tx
            .update(productVariants)
            .set(cambios)
            .where(eq(productVariants.id, enviada.id));
        }
      }

      // --- Rutas a refrescar -------------------------------------------------

      const idsCategoria = [actual.categoriaId, entrada.categoriaId].filter(
        (id): id is string => Boolean(id),
      );

      const slugs = idsCategoria.length
        ? await tx
            .select({ id: categories.id, slug: categories.slug })
            .from(categories)
        : [];

      const slugDe = (id: string | null) =>
        id ? (slugs.find((c) => c.id === id)?.slug ?? null) : null;

      return {
        slug: actual.slug,
        slugCategoriaVieja: slugDe(actual.categoriaId),
        slugCategoriaNueva: slugDe(entrada.categoriaId),
        huboCambios: Object.keys(cambiosProducto).length > 0 || variantesTocadas > 0,
      };
    });

    if (!efecto.huboCambios) {
      return { ok: true, mensaje: "No había nada que cambiar.", avisos };
    }

    /**
     * Refresco de las vistas públicas.
     *
     * Las páginas del panel son force-dynamic, pero la ficha del producto es
     * ISR (revalidate 3600): sin esto, un precio corregido tarda hasta una hora
     * en verse. Las de categoría y la portada son dinámicas hoy, y se incluyen
     * igual para que sigan correctas si mañana se les pone caché.
     *
     * Se pasa además el patrón de la ruta dinámica: con `trailingSlash: true`
     * la ruta literal es la buena, pero el patrón cubre cualquier variante de
     * la clave de caché sin depender de ese detalle.
     */
    const rutas = new Set<string>(["/", "/tienda/"]);

    for (const slugCategoria of [efecto.slugCategoriaVieja, efecto.slugCategoriaNueva]) {
      if (slugCategoria) rutas.add(`/${slugCategoria}/`);
      rutas.add(rutaProducto(slugCategoria, efecto.slug));
    }

    for (const ruta of rutas) revalidatePath(ruta);

    // El patrón de la ruta dinámica, además de las rutas literales: cubre la
    // clave de caché de la ficha aunque `trailingSlash` la escriba distinto.
    // Invalida todas las fichas, no solo esta; con la base en el mismo host y
    // las consultas indexadas, regenerarlas bajo demanda cuesta milisegundos,
    // y es barato al lado de mostrar un precio viejo durante una hora.
    revalidatePath("/tienda/[categoria]/[producto]", "page");
    // Mismo patrón para la página de categoría: sin esto, mover un producto
    // de categoría o cambiar su destacado tarda hasta una hora en verse ahí.
    revalidatePath("/[categoria]", "page");

    // Las vitrinas de la portada y el menú de categorías van en caché por
    // etiqueta (unstable_cache), que revalidatePath no toca: sin esto, un
    // precio corregido o una categoría movida seguiría saliendo vieja hasta
    // una hora.
    revalidateTag(ETIQUETA_CATALOGO, "max");

    // El panel es force-dynamic —no hay página cacheada que expirar— pero esto
    // sí bota la copia que el router guarda en el navegador: sin ello, volver
    // a la lista con el botón de atrás muestra el precio anterior.
    revalidatePath("/admin/productos/");

    return {
      ok: true,
      mensaje: "Cambios guardados.",
      avisos,
    };
  } catch (e) {
    if (e instanceof FalloEdicion) return e.estado;

    const pg = errorPg(e);

    if (pg?.code === "23505") {
      if (pg.constraint === "product_variants_sku_uq") {
        return { error: "Ese SKU ya lo tiene otra variante. Los SKU no se repiten." };
      }
      if (pg.constraint === "product_variants_product_name_uq") {
        return { error: "Dos variantes de este producto no pueden llamarse igual." };
      }
      return { error: "Ese valor ya está en uso en otro producto." };
    }

    if (pg?.code === "23503") {
      return { error: "La categoría que escogiste ya no existe. Recarga la ficha." };
    }

    if (pg?.code === "23514") {
      return {
        error:
          "La base rechazó los datos por una regla de integridad. Revisa el precio y el stock.",
      };
    }

    console.error("guardarProducto: fallo inesperado", e);
    return { error: "No pudimos guardar los cambios. Intenta de nuevo." };
  }
}

/**
 * ============================================================================
 * Retirar un producto del catálogo
 * ============================================================================
 *
 * NO siempre borra, y esa es la parte importante.
 *
 * Si el producto se vendió alguna vez, se ARCHIVA: cambia a estado
 * `archivado`, desaparece de la tienda igual que si no existiera, pero la fila
 * sobrevive. Borrarlo pondría `order_items.product_id` en NULL (la FK es
 * `on delete set null`) y los pedidos viejos perderían el enlace al producto.
 * El historial seguiría legible —order_items guarda copia del nombre y del
 * precio— pero nadie podría volver a abrir la ficha desde un pedido, y quien
 * mira la contabilidad del año pasado se queda sin saber qué vendió.
 *
 * Si nunca se vendió, se BORRA de verdad: no hay historial que proteger y
 * dejar basura archivada solo estorba. Las variantes, imágenes, reseñas y
 * líneas de carrito caen en cascada.
 *
 * Quien decide es la base, no quien pulsa: se cuenta si hay `order_items`
 * ligados a alguna variante de este producto, dentro de la misma transacción
 * que hace el cambio. Comprobar antes y borrar después dejaría una rendija por
 * la que una compra simultánea perdería su enlace.
 *
 * SOLO ADMIN. Guardar el catálogo lo puede hacer `staff`; retirar un producto
 * de la tienda, no: es destructivo y no tiene botón de deshacer.
 */
export async function eliminarProducto(
  _previo: EstadoFormularioProducto | undefined,
  datos: FormData,
): Promise<EstadoFormularioProducto> {
  const sesion = await auth();
  if (!sesion?.user?.id) {
    return { error: "Tu sesión se cerró. Entra otra vez y vuelve a intentarlo." };
  }

  if ((await rolReal(sesion.user.id)) !== "admin") {
    return { error: "Solo un administrador puede retirar productos del catálogo." };
  }

  const id = texto(datos, "id");
  if (!id) return { error: "Falta el producto que hay que retirar." };

  /**
   * Confirmación explícita. El formulario manda `confirmacion` con el nombre
   * del producto escrito a mano: sin esto, un clic accidental en un botón rojo
   * borra un producto y no hay vuelta atrás.
   */
  const confirmacion = texto(datos, "confirmacion");

  try {
    const resultado = await db.transaction(async (tx) => {
      const [producto] = await tx
        .select({
          id: products.id,
          nombre: products.name,
          slug: products.slug,
          estado: products.status,
          slugCategoria: categories.slug,
        })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(eq(products.id, id))
        .limit(1);

      if (!producto) {
        return { error: "Ese producto ya no existe. Recarga la lista." } as const;
      }

      if (confirmacion.trim().toLowerCase() !== producto.nombre.trim().toLowerCase()) {
        return {
          error: `Para confirmar, escribe el nombre exacto del producto: ${producto.nombre}`,
        } as const;
      }

      // ¿Se vendió alguna vez? Basta con saber si existe UNA línea.
      const [venta] = await tx
        .select({ id: orderItems.id })
        .from(orderItems)
        .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
        .where(eq(productVariants.productId, id))
        .limit(1);

      if (venta) {
        await tx
          .update(products)
          // Se le quita lo de destacado: un archivado no debe seguir
          // reservando un hueco en la portada.
          .set({ status: "archivado", isFeatured: false })
          .where(eq(products.id, id));

        return {
          archivado: true,
          nombre: producto.nombre,
          slug: producto.slug,
          slugCategoria: producto.slugCategoria,
        } as const;
      }

      await tx.delete(products).where(eq(products.id, id));

      return {
        archivado: false,
        nombre: producto.nombre,
        slug: producto.slug,
        slugCategoria: producto.slugCategoria,
      } as const;
    });

    if ("error" in resultado) return { error: resultado.error };

    const rutas = new Set<string>(["/", "/tienda/", "/admin/productos/"]);
    if (resultado.slugCategoria) rutas.add(`/${resultado.slugCategoria}/`);
    rutas.add(rutaProducto(resultado.slugCategoria, resultado.slug));
    for (const ruta of rutas) revalidatePath(ruta);
    revalidatePath("/tienda/[categoria]/[producto]", "page");
    revalidatePath("/[categoria]", "page");

    // Las vitrinas de la portada y el menú de categorías van en caché por
    // etiqueta (unstable_cache), que revalidatePath no toca: sin esto, un
    // producto retirado seguiría saliendo en la portada o su categoría hasta
    // una hora.
    revalidateTag(ETIQUETA_CATALOGO, "max");

    return {
      ok: true,
      mensaje: resultado.archivado
        ? `"${resultado.nombre}" se archivó: ya no aparece en la tienda, y los pedidos que lo incluyen siguen completos.`
        : `"${resultado.nombre}" se eliminó del catálogo.`,
      eliminado: true,
    };
  } catch (e) {
    console.error("eliminarProducto: fallo inesperado", e);
    return { error: "No pudimos retirar el producto. Intenta de nuevo." };
  }
}

// ============================================================================
// Crear producto nuevo
// ============================================================================

/**
 * Genera un slug único a partir del nombre. Si el base ya existe, prueba
 * `-2`, `-3`… El slug es una URL de SEO; se deriva del nombre en vez de
 * pedirlo, pero no puede repetirse (el índice único lo rechazaría).
 */
async function slugUnico(nombre: string): Promise<string> {
  const base = generarSlug(nombre) || "producto";

  const existentes = await db
    .select({ slug: products.slug })
    .from(products)
    .where(sql`${products.slug} = ${base} or ${products.slug} like ${base + "-%"}`);

  const tomados = new Set(existentes.map((f) => f.slug));
  if (!tomados.has(base)) return base;

  for (let i = 2; i < 1000; i++) {
    const candidato = `${base}-${i}`;
    if (!tomados.has(candidato)) return candidato;
  }
  // Improbable: mil productos con el mismo nombre. Un sufijo aleatorio corta el caso.
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Crea un producto simple: el producto, su variante única y, si se subió, la
 * imagen principal. Todo en una transacción. Nace en el estado que elija la
 * persona —por defecto borrador, para revisarlo antes de publicarlo— y con la
 * posición al final del catálogo.
 *
 * Los productos con varias presentaciones se crean así (simples) y se les
 * añaden variantes después, en la ficha de edición.
 */
export async function crearProducto(
  _previo: ResultadoAccion | undefined,
  datos: FormData,
): Promise<ResultadoAccion> {
  let idNuevo: string | null = null;

  const resultado = await ejecutar("crear-producto", async () => {
    await exigirPersonal();

    const analisis = esquemaCrearProducto.safeParse({
      nombre: datos.get("nombre"),
      descripcion: datos.get("descripcion"),
      categoriaId: datos.get("categoriaId") ?? "",
      precioCop: datos.get("precioCop") ?? "",
      stock: datos.get("stock") ?? "",
      imagenUrl: datos.get("imagenUrl") ?? "",
      estado: datos.get("estado"),
      destacado: datos.get("destacado") === "on",
    });

    if (!analisis.success) {
      return { ok: false, error: analisis.error.issues[0]?.message ?? "Revisa los campos." };
    }

    const d = analisis.data;
    const slug = await slugUnico(d.nombre);

    idNuevo = await db.transaction(async (tx) => {
      // La posición al final: max(position) + 1 entre todos los productos.
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<number>`coalesce(max(${products.position}), -1)::int` })
        .from(products);

      const [prod] = await tx
        .insert(products)
        .values({
          name: d.nombre,
          slug,
          description: d.descripcion,
          categoryId: d.categoriaId,
          status: d.estado,
          isFeatured: d.destacado,
          position: maxPos + 1,
        })
        .returning({ id: products.id });

      const productoId = prod!.id;

      await tx.insert(productVariants).values({
        productId: productoId,
        name: "Única",
        priceCop: d.precioCop,
        stock: d.stock,
        isActive: true,
        position: 0,
      });

      if (d.imagenUrl) {
        await tx.insert(productImages).values({
          productId: productoId,
          url: d.imagenUrl,
          altText: d.nombre,
          position: 0,
        });
      }

      return productoId;
    });

    return { ok: true };
  });

  if (resultado.ok && idNuevo) {
    revalidatePath("/admin/productos");
    revalidatePath("/admin");
    // A la ficha de edición: ahí se ajusta lo fino (más variantes, SEO, fotos).
    redirect(`/admin/productos/${idNuevo}/`);
  }

  return resultado;
}
