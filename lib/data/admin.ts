import "server-only";

import { and, count, desc, eq, gte, ilike, inArray, or, sql, sum } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  categories,
  orderItems,
  orders,
  productVariants,
  products,
  users,
} from "@/lib/db/schema";
import { rutaProducto } from "@/lib/data/catalogo";
import { TIENDA } from "@/tienda.config";

/**
 * Consultas del panel de administración.
 *
 * SIN RLS: la autorización es responsabilidad de quien llama. Todas las
 * páginas que usan esto pasan primero por `esPersonalAutorizado()`, que relee
 * el rol de la base y no se fía del token.
 */

/**
 * Un pedido cuenta para la ruta del día si ya está cobrado... O si es contra
 * entrega todavía pendiente: ahí el cobro ocurre EN la puerta, así que
 * excluir los `pendiente` dejaba la pantalla más usada del panel vacía
 * justamente el día de la entrega (con contra entrega como único método
 * activo, TODO pedido vive en `pendiente` hasta que vuelve el domiciliario).
 */
const FILTRO_ENTREGABLE = sql`(${orders.status} in ('pagado','en_preparacion','enviado') or (${orders.status} = 'pendiente' and ${orders.paymentMethod} = 'contra-entrega'))`;

// ============================================================================
// Resumen
// ============================================================================

export type Resumen = {
  ventasCop: number;
  pedidosPagados: number;
  pedidosPendientes: number;
  entregasHoy: number;
  productosActivos: number;
  productosAgotados: number;
  clientes: number;
};

export async function leerResumen(hoy: string): Promise<Resumen> {
  // Una sola consulta con agregados condicionales en vez de siete viajes a la
  // base. Con `filter` cada contador ve solo las filas que le tocan.
  const [pedidos] = await db
    .select({
      ventasCop: sql<number>`coalesce(sum(${orders.totalCop}) filter (where ${orders.status} = 'pagado'), 0)::int`,
      pagados: sql<number>`count(*) filter (where ${orders.status} = 'pagado')::int`,
      pendientes: sql<number>`count(*) filter (where ${orders.status} = 'pendiente')::int`,
      entregasHoy: sql<number>`count(*) filter (where ${orders.deliveryDate} = ${hoy}::date and ${FILTRO_ENTREGABLE})::int`,
    })
    .from(orders);

  /**
   * "Agotado" con la MISMA regla que la lista de productos: la suma del stock
   * de las variantes activas. Contar variante por variante (y encima incluir
   * las desactivadas) hacía que el resumen y la lista dieran números
   * distintos para el mismo catálogo.
   */
  const porProducto = db
    .select({
      estado: products.status,
      stockActivo:
        sql<number>`coalesce(sum(${productVariants.stock}) filter (where ${productVariants.isActive}), 0)`.as(
          "stock_activo",
        ),
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .groupBy(products.id, products.status)
    .as("por_producto");

  const [catalogo] = await db
    .select({
      activos: sql<number>`count(*) filter (where ${porProducto.estado} = 'activo')::int`,
      agotados: sql<number>`count(*) filter (where ${porProducto.estado} = 'activo' and ${porProducto.stockActivo} <= 0)::int`,
    })
    .from(porProducto);

  const [clientes] = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.role, "cliente"));

  return {
    ventasCop: pedidos?.ventasCop ?? 0,
    pedidosPagados: pedidos?.pagados ?? 0,
    pedidosPendientes: pedidos?.pendientes ?? 0,
    entregasHoy: pedidos?.entregasHoy ?? 0,
    productosActivos: catalogo?.activos ?? 0,
    productosAgotados: catalogo?.agotados ?? 0,
    clientes: clientes?.total ?? 0,
  };
}

// ============================================================================
// Entregas
// ============================================================================

export type Entrega = {
  id: string;
  numero: string;
  estado: string;
  /** Para avisar en la tarjeta que hay que COBRAR al entregar. */
  metodoPago: string | null;
  franja: string | null;
  destinatario: string | null;
  telefonoDestinatario: string | null;
  municipio: string | null;
  direccion: string | null;
  indicaciones: string | null;
  mensajeTarjeta: string | null;
  totalCop: number;
  articulos: string[];
};

/**
 * La ruta del día.
 *
 * Esta pantalla no existía en el starter, que modelaba un ecommerce genérico.
 * Aquí es la vista más usada: cada mañana alguien necesita saber qué armar,
 * qué tarjeta escribir y a quién llamar.
 *
 * Por eso `gift_message`, `recipient_*` y `delivery_*` son columnas y no
 * campos dentro del jsonb de shipping_address: esta consulta usa el índice
 * parcial `orders_delivery_date_idx` en vez de escanear la tabla.
 */
export async function listarEntregas(fecha: string): Promise<Entrega[]> {
  const filas = await db
    .select({
      id: orders.id,
      numero: orders.orderNumber,
      estado: orders.status,
      metodoPago: orders.paymentMethod,
      franja: orders.deliverySlot,
      destinatario: orders.recipientName,
      telefonoDestinatario: orders.recipientPhone,
      direccionJson: orders.shippingAddress,
      indicaciones: orders.notes,
      mensajeTarjeta: orders.giftMessage,
      totalCop: orders.totalCop,
    })
    .from(orders)
    .where(and(eq(orders.deliveryDate, fecha), FILTRO_ENTREGABLE))
    // Por franja para que la ruta salga en orden de la mañana a la noche.
    .orderBy(orders.deliverySlot, orders.orderNumber);

  if (filas.length === 0) return [];

  const articulos = await db
    .select({
      pedidoId: orderItems.orderId,
      nombre: orderItems.productName,
      cantidad: orderItems.quantity,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, filas.map((f) => f.id)));

  const porPedido = new Map<string, string[]>();
  for (const a of articulos) {
    const lista = porPedido.get(a.pedidoId) ?? [];
    lista.push(`${a.cantidad} × ${a.nombre}`);
    porPedido.set(a.pedidoId, lista);
  }

  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    metodoPago: f.metodoPago,
    franja: f.franja,
    destinatario: f.destinatario,
    telefonoDestinatario: f.telefonoDestinatario,
    municipio: f.direccionJson?.ciudad ?? null,
    direccion: f.direccionJson?.line1 ?? null,
    indicaciones: f.indicaciones,
    mensajeTarjeta: f.mensajeTarjeta,
    totalCop: f.totalCop,
    articulos: porPedido.get(f.id) ?? [],
  }));
}

// ============================================================================
// Pedidos
// ============================================================================

export type PedidoAdmin = {
  id: string;
  numero: string;
  estado: string;
  cliente: string | null;
  correo: string;
  /** Para llamar o escribir sin tener que abrir el detalle. */
  telefono: string | null;
  totalCop: number;
  metodoPago: string | null;
  creado: Date;
  fechaEntrega: string | null;
  franja: string | null;
};

/** Los siete valores del enum, para validar el filtro que llega por URL. */
const ESTADOS_VALIDOS = [
  "pendiente",
  "pagado",
  "en_preparacion",
  "enviado",
  "entregado",
  "cancelado",
  "reembolsado",
] as const;

export async function listarPedidos(opciones?: {
  estado?: string;
  /** Busca por número de pedido, nombre o correo del comprador. */
  buscar?: string;
  limite?: number;
}): Promise<PedidoAdmin[]> {
  const estado = ESTADOS_VALIDOS.find((e) => e === opciones?.estado);

  /**
   * El término se interpola dentro de un patrón ilike, así que `%` y `_`
   * dejarían de ser texto y se volverían comodines: un solo `%` listaría
   * toda la tabla. Van escapados.
   */
  const termino = opciones?.buscar?.trim().replace(/[%_\\]/g, "\\$&") ?? "";

  const filtros = [
    estado ? eq(orders.status, estado) : undefined,
    termino
      ? or(
          ilike(orders.orderNumber, `%${termino}%`),
          ilike(orders.customerName, `%${termino}%`),
          ilike(orders.email, `%${termino}%`),
        )
      : undefined,
  ].filter(Boolean);

  return db
    .select({
      id: orders.id,
      numero: orders.orderNumber,
      estado: orders.status,
      cliente: orders.customerName,
      correo: orders.email,
      telefono: orders.phone,
      totalCop: orders.totalCop,
      metodoPago: orders.paymentMethod,
      creado: orders.createdAt,
      fechaEntrega: orders.deliveryDate,
      franja: orders.deliverySlot,
    })
    .from(orders)
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(opciones?.limite ?? 100);
}

/**
 * Cuántos pedidos hay y cuánto suman, por estado.
 *
 * Es la pregunta que se hace de verdad al abrir la pantalla ("¿cuántos han
 * pedido?"), y no se puede sacar de la lista: esa está recortada a los últimos
 * 100. Este conteo mira TODA la tabla.
 *
 * El total vendido cuenta solo lo pagado o posterior (enviado, entregado):
 * sumar los pendientes infla la caja con pedidos que nadie ha cobrado.
 */
export type ResumenPedidos = {
  total: number;
  pendientes: number;
  pagados: number;
  hoy: number;
  vendidoCop: number;
};

export async function resumenPedidos(): Promise<ResumenPedidos> {
  const zona = TIENDA.ubicacion.zonaHoraria;
  const { rows } = await db.execute<{
    total: number;
    pendientes: number;
    pagados: number;
    hoy: number;
    vendido_cop: number;
  }>(sql`
    select
      count(*)::int                                                        as total,
      count(*) filter (where status = 'pendiente')::int                    as pendientes,
      count(*) filter (where status = 'pagado')::int                       as pagados,
      count(*) filter (
        where (created_at at time zone ${zona})::date
            = (now() at time zone ${zona})::date)::int                     as hoy,
      coalesce(sum(total_cop) filter (
        where status in ('pagado', 'en_preparacion', 'enviado', 'entregado')
      ), 0)::int                                                           as vendido_cop
    from public.orders
  `);

  const f = rows[0];
  return {
    total: f?.total ?? 0,
    pendientes: f?.pendientes ?? 0,
    pagados: f?.pagados ?? 0,
    hoy: f?.hoy ?? 0,
    vendidoCop: f?.vendido_cop ?? 0,
  };
}

// ============================================================================
// Catálogo
// ============================================================================

export type ProductoAdmin = {
  id: string;
  slug: string;
  nombre: string;
  estado: string;
  destacado: boolean;
  categoria: string | null;
  /** Necesario para armar la ruta pública. El nombre no sirve: que
   *  "Accesorios" en minúsculas coincida con su slug es casualidad, no
   *  regla. */
  categoriaSlug: string | null;
  precioCop: number | null;
  stock: number;
  variantes: number;
};

export async function listarProductosAdmin(): Promise<ProductoAdmin[]> {
  const filas = await db
    .select({
      id: products.id,
      slug: products.slug,
      nombre: products.name,
      estado: products.status,
      destacado: products.isFeatured,
      categoria: sql<string | null>`(select c.name from categories c where c.id = ${products.categoryId})`,
      categoriaSlug: sql<string | null>`(select c.slug from categories c where c.id = ${products.categoryId})`,
      // El "desde" solo con variantes que se venden: una variante barata
      // desactivada mostraba un precio que el cliente jamás va a ver.
      precioCop: sql<number | null>`(min(${productVariants.priceCop}) filter (where ${productVariants.isActive}))::int`,
      // Stock total sumando variantes activas. Un producto con dos variantes
      // agotadas y una con stock NO está agotado.
      stock: sql<number>`coalesce(sum(${productVariants.stock}) filter (where ${productVariants.isActive}), 0)::int`,
      variantes: sql<number>`count(${productVariants.id}) filter (where ${productVariants.isActive})::int`,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .groupBy(
      products.id,
      products.slug,
      products.name,
      products.status,
      products.isFeatured,
      products.categoryId,
      products.position,
    )
    .orderBy(products.position, products.name);

  return filas;
}

/** Productos activos sin stock. Lo primero que hay que reponer. */
export async function listarAgotados(): Promise<ProductoAdmin[]> {
  const todos = await listarProductosAdmin();
  return todos.filter((p) => p.estado === "activo" && p.stock <= 0);
}

// ============================================================================
// Clientes
// ============================================================================

export type ClienteAdmin = {
  id: string;
  nombre: string | null;
  correo: string;
  rol: string;
  registrado: Date;
  pedidos: number;
  gastadoCop: number;
};

export async function listarClientes(): Promise<ClienteAdmin[]> {
  return db
    .select({
      id: users.id,
      nombre: users.name,
      correo: users.email,
      rol: users.role,
      registrado: users.createdAt,
      pedidos: sql<number>`count(${orders.id})::int`,
      gastadoCop: sql<number>`coalesce(sum(${orders.totalCop}) filter (where ${orders.status} = 'pagado'), 0)::int`,
    })
    .from(users)
    .leftJoin(orders, eq(orders.userId, users.id))
    .groupBy(users.id, users.name, users.email, users.role, users.createdAt)
    .orderBy(desc(users.createdAt))
    .limit(200);
}

// ============================================================================
// Ficha de edición
// ============================================================================

export type CategoriaAdmin = {
  id: string;
  slug: string;
  nombre: string;
};

export type VarianteAdmin = {
  id: string;
  nombre: string;
  sku: string | null;
  precioCop: number;
  /** Precio tachado. Solo se muestra; no se edita desde el panel. */
  precioAntesCop: number | null;
  stock: number;
  posicion: number;
  activa: boolean;
  /** `updated_at` en milisegundos. Ver la nota de concurrencia en la action. */
  version: number;
};

export type FichaProductoAdmin = {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  descripcionHtml: string | null;
  estado: string;
  destacado: boolean;
  categoriaId: string | null;
  categoriaNombre: string | null;
  posicion: number;
  seoTitulo: string | null;
  seoDescripcion: string | null;
  creado: Date;
  actualizado: Date;
  version: number;
  /** Ruta de la ficha pública, con la barra final que exige `trailingSlash`. */
  rutaPublica: string;
  imagenes: number;
  variantes: VarianteAdmin[];
};

/**
 * El producto entero para la pantalla de edición.
 *
 * Devuelve `version` —`updated_at` en milisegundos— además de los datos: es lo
 * que el formulario manda de vuelta para que la action detecte si alguien más
 * guardó mientras tanto. En milisegundos y no como fecha porque el driver de
 * Postgres redondea los microsegundos al convertir a `Date`, y comparar
 * números enteros que salieron los dos del mismo conversor no falla nunca.
 */
export async function leerProductoAdmin(
  id: string,
): Promise<FichaProductoAdmin | null> {
  const fila = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      category: true,
      variants: {
        orderBy: (v, { asc }) => [asc(v.position), asc(v.name)],
      },
      images: { columns: { id: true } },
    },
  });

  if (!fila) return null;

  return {
    id: fila.id,
    slug: fila.slug,
    nombre: fila.name,
    descripcion: fila.description,
    descripcionHtml: fila.descriptionHtml,
    estado: fila.status,
    destacado: fila.isFeatured,
    categoriaId: fila.categoryId,
    categoriaNombre: fila.category?.name ?? null,
    posicion: fila.position,
    seoTitulo: fila.seoTitle,
    seoDescripcion: fila.seoDescription,
    creado: fila.createdAt,
    actualizado: fila.updatedAt,
    version: fila.updatedAt.getTime(),
    rutaPublica: rutaProducto(fila.category?.slug ?? null, fila.slug),
    imagenes: fila.images?.length ?? 0,
    variantes: (fila.variants ?? []).map((v) => ({
      id: v.id,
      nombre: v.name,
      sku: v.sku,
      precioCop: v.priceCop,
      precioAntesCop: v.compareAtPriceCop,
      stock: v.stock,
      posicion: v.position,
      activa: v.isActive,
      version: v.updatedAt.getTime(),
    })),
  };
}

/** Categorías para el selector de la ficha. Incluye las inactivas: un producto
 *  puede estar colgado de una y hay que poder verlo y moverlo. Todas las
 *  filas de la tabla: el panel no tiene CRUD de categorías, así que la lista
 *  siempre es la que sembró `lib/db/seed.ts` a partir de `tienda.config.ts`. */
export async function listarCategoriasAdmin(): Promise<CategoriaAdmin[]> {
  return db
    .select({ id: categories.id, slug: categories.slug, nombre: categories.name })
    .from(categories)
    .orderBy(categories.position, categories.name);
}
