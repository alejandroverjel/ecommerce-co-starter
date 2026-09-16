import { eq, sql } from "drizzle-orm";

import { TIENDA, type ConfigTienda } from "../../tienda.config";
import { closeDb, db } from "./index";
import {
  categories,
  paymentGateways,
  products,
  productVariants,
  storeSettings,
} from "./schema";

/**
 * ============================================================================
 * Seed OBLIGATORIO. Correr en cada deploy, antes de levantar la app.
 * ============================================================================
 *
 * BUG 1: en el starter original, dos documentos referenciaban un `seed.sql` que
 * nunca existio. Resultado: `store_settings` vacia, el `coalesce(v_flat, 0)` de
 * create_pending_order devolvia 0, y la tienda cobraba envio $0 mientras la
 * interfaz mostraba otro valor. Este archivo es ese seed que faltaba.
 *
 * Es IDEMPOTENTE: correrlo dos veces no rompe nada y no pisa datos de negocio
 * ni ajustes ya editados desde el panel.
 *
 * Uso:
 *   pnpm tsx lib/db/seed.ts
 * y en el Dockerfile / entrypoint, despues de `drizzle-kit migrate`.
 *
 * SIN top-level await: esbuild empaqueta este archivo en CJS (script
 * `herramientas` de package.json) para poder correrlo en produccion, y CJS no
 * admite await de nivel superior. Todo el trabajo vive dentro de `main()`.
 */

/** Slugs que ninguna categoria puede usar: colisionarian con una ruta de la app. */
const SLUGS_RESERVADOS = [
  "tienda",
  "carrito",
  "finalizar-compra",
  "contactenos",
  "mi-cuenta",
  "admin",
  "entrar",
  "crear-cuenta",
  "recuperar",
  "recuperar-carrito",
  "baja-correos",
  "api",
  "uploads",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  "terminos-y-condiciones",
  "politica-de-privacidad",
  "politica-de-devoluciones",
  "politica-de-entrega",
];

/** "3000000000" -> "573000000000". Sin numero, sin WhatsApp: "". */
function derivarWhatsapp(numero: string | null): string {
  return numero ? `57${numero}` : "";
}

/**
 * store_settings (singleton).
 *
 * 1) ARRANQUE: crea la fila si no existe. Es una red de seguridad; en
 *    condiciones normales ya la crea 0002_seed.sql con valores neutros de
 *    fabrica.
 * 2) SINCRONIZACION CONDICIONADA: si la fila sigue "de fabrica"
 *    (`updated_at = created_at`, o sea nadie la ha tocado desde
 *    /admin/ajustes), se alinea con TIENDA.envioInicial. Desde la primera
 *    edicion en el panel, manda la base y el seed ya no pisa nada.
 */
async function alinearStoreSettings(): Promise<void> {
  const { envioPlanoCop, umbralEnvioGratisCop, ivaBps, minutosReserva } =
    TIENDA.envioInicial;

  // Los mismos limites que los CHECK de 0000_schema.sql. Fallar aqui, con un
  // mensaje claro, es mejor que fallar en el INSERT/UPDATE.
  const errores: string[] = [];
  if (!Number.isInteger(envioPlanoCop) || envioPlanoCop < 0) {
    errores.push(`envioInicial.envioPlanoCop invalido: ${envioPlanoCop}`);
  }
  if (!Number.isInteger(umbralEnvioGratisCop) || umbralEnvioGratisCop < 0) {
    errores.push(
      `envioInicial.umbralEnvioGratisCop invalido: ${umbralEnvioGratisCop}`,
    );
  }
  if (!Number.isInteger(ivaBps) || ivaBps < 0 || ivaBps > 10_000) {
    errores.push(`envioInicial.ivaBps fuera de rango (0-10000): ${ivaBps}`);
  }
  if (!Number.isInteger(minutosReserva) || minutosReserva <= 0) {
    errores.push(`envioInicial.minutosReserva invalido: ${minutosReserva}`);
  }
  if (errores.length > 0) {
    console.error("[seed] TIENDA.envioInicial invalido:", errores.join("; "));
    process.exit(1);
  }

  const [creada] = await db
    .insert(storeSettings)
    .values({
      id: true,
      storeName: TIENDA.nombre,
      contactEmail: TIENDA.contacto.correo,
      whatsappNumber: derivarWhatsapp(TIENDA.contacto.whatsapp),
      flatShippingCop: envioPlanoCop,
      freeShippingThresholdCop: umbralEnvioGratisCop,
      taxRateBps: ivaBps,
      reservationTtlMinutes: minutosReserva,
      currency: TIENDA.ubicacion.moneda,
    })
    .onConflictDoNothing({ target: storeSettings.id })
    .returning();

  if (creada) {
    console.log(`[seed] store_settings creada desde TIENDA (${TIENDA.nombre})`);
    return;
  }

  const alineadas = await db
    .update(storeSettings)
    .set({
      storeName: TIENDA.nombre,
      contactEmail: TIENDA.contacto.correo,
      whatsappNumber: derivarWhatsapp(TIENDA.contacto.whatsapp),
      flatShippingCop: envioPlanoCop,
      freeShippingThresholdCop: umbralEnvioGratisCop,
      taxRateBps: ivaBps,
      reservationTtlMinutes: minutosReserva,
      // El UPDATE dispara trg_store_settings_updated_at (updated_at := now()).
      // Fijar las dos marcas a now() —la hora de la transaccion, igual para
      // ambas— mantiene created_at = updated_at: la fila sigue contando como
      // de fabrica y el seed siguiente la puede volver a alinear.
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(sql`${storeSettings.updatedAt} = ${storeSettings.createdAt}`)
    .returning({ id: storeSettings.id });

  if (alineadas.length > 0) {
    console.log(
      "[seed] store_settings alineada con TIENDA.envioInicial (fila de fabrica)",
    );
  } else {
    console.log(
      "[seed] store_settings ya fue editada desde /admin/ajustes, no se toca",
    );
  }
}

/**
 * payment_gateways — las tres declaradas, TODAS apagadas.
 *
 * Encenderlas es decision del administrador desde el panel, cuando ya haya
 * pegado las llaves. Encender una aqui, en el deploy, la ofreceria en el
 * checkout sin credenciales y el cliente veria "pedido recibido" sin que
 * nadie le cobrara.
 */
async function alinearPasarelas(): Promise<void> {
  await db
    .insert(paymentGateways)
    .values([
      {
        gateway: "mercadopago",
        displayName: "Mercado Pago",
        isEnabled: false,
        position: 0,
      },
      { gateway: "wompi", displayName: "Wompi", isEnabled: false, position: 1 },
      { gateway: "epayco", displayName: "ePayco", isEnabled: false, position: 2 },
    ])
    .onConflictDoUpdate({
      target: paymentGateways.gateway,
      /**
       * OJO con lo que decia antes: `set: { displayName: paymentGateways.displayName }`
       * genera `set display_name = "payment_gateways"."display_name"`, o sea la
       * columna igual a si misma: un UPDATE que no actualiza nada. Como
       * 0002_seed.sql ya crea las tres filas APAGADAS, ese no-op hacia que
       * `pnpm db:seed` no encendiera una pasarela nunca. Hay que escribir
       * `excluded.*`.
       *
       * YA NO manda el entorno. Desde que el panel permite encender y apagar
       * pasarelas y guardar sus llaves, pisar is_enabled, is_sandbox y
       * public_key en cada deploy borraria lo que el administrador acaba de
       * configurar.
       *
       * Aqui solo se actualiza lo que es puramente presentacion y nunca se
       * edita desde el panel.
       */
      set: {
        displayName: sql`excluded.display_name`,
        position: sql`excluded.position`,
      },
    });

  console.log("[seed] payment_gateways listo");
}

/**
 * TIENDA.catalogo.categoriasIniciales — el panel no tiene CRUD de categorias,
 * asi que las siembra este script. `ON CONFLICT (slug) DO NOTHING`: una
 * categoria ya creada (o renombrada desde psql) no se pisa.
 */
async function sembrarCategorias(): Promise<void> {
  // Anotado con el tipo del CONTRATO (no el literal que infiere `as const`
  // sobre el arreglo de fábrica de tienda.config.ts): en produccion puede
  // tener 0, 1 o varias categorias, y TIENDA.catalogo.categoriasIniciales[i]
  // puede o no traer `descripcion`.
  const iniciales: ConfigTienda["catalogo"]["categoriasIniciales"] =
    TIENDA.catalogo.categoriasIniciales;

  for (const categoria of iniciales) {
    if (SLUGS_RESERVADOS.includes(categoria.slug)) {
      console.error(
        `[seed] categoriasIniciales: el slug "${categoria.slug}" esta reservado ` +
          "para una ruta de la app y no puede usarse como categoria",
      );
      process.exit(1);
    }
  }

  if (iniciales.length === 0) {
    console.log("[seed] TIENDA.catalogo.categoriasIniciales vacio, nada que sembrar");
    return;
  }

  await db
    .insert(categories)
    .values(
      iniciales.map((categoria, indice) => ({
        slug: categoria.slug,
        name: categoria.nombre,
        description: categoria.descripcion ?? null,
        position: indice,
      })),
    )
    .onConflictDoNothing({ target: categories.slug });

  console.log(`[seed] categoriasIniciales listo (${iniciales.length})`);
}

const PRODUCTOS_DEMO = [
  { slug: "producto-demo-1", nombre: "Producto de demostración 1", precioCop: 25_000 },
  { slug: "producto-demo-2", nombre: "Producto de demostración 2", precioCop: 40_000 },
] as const;

/**
 * SEED_DEMO=1 (solo local o CI): dos productos de demostracion, activos, con
 * una variante "Única", stock 10 y sin imagen. Idempotentes por slug: correr
 * el seed otra vez no duplica nada.
 */
async function sembrarProductosDemo(): Promise<void> {
  if (process.env.SEED_DEMO !== "1") return;

  const primeraCategoria = TIENDA.catalogo.categoriasIniciales[0];
  if (!primeraCategoria) {
    // Sin categorías iniciales no hay dónde colgar el producto: uno sin
    // categoría no tiene ruta pública (lib/data/catalogo.ts excluye esos
    // productos de las vitrinas con innerJoin), así que sembrarlo solo
    // crearía un producto invisible e inaccesible.
    console.log("[seed] SEED_DEMO=1 pero categoriasIniciales esta vacio: no se crean productos de demostracion");
    return;
  }

  const [categoria] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, primeraCategoria.slug))
    .limit(1);
  const categoriaId = categoria?.id ?? null;

  if (!categoriaId) {
    console.log("[seed] SEED_DEMO=1 pero la categoria inicial no existe todavia: no se crean productos de demostracion");
    return;
  }

  for (const demo of PRODUCTOS_DEMO) {
    const [creado] = await db
      .insert(products)
      .values({
        slug: demo.slug,
        name: demo.nombre,
        status: "activo",
        categoryId: categoriaId,
      })
      .onConflictDoNothing({ target: products.slug })
      .returning({ id: products.id });

    let productoId = creado?.id;
    if (!productoId) {
      const [existente] = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, demo.slug))
        .limit(1);
      productoId = existente?.id;
    }
    if (!productoId) continue;

    await db
      .insert(productVariants)
      .values({
        productId: productoId,
        name: "Única",
        priceCop: demo.precioCop,
        stock: 10,
      })
      .onConflictDoNothing({
        target: [productVariants.productId, productVariants.name],
      });
  }

  console.log("[seed] SEED_DEMO=1: productos de demostracion listos");
}

async function main(): Promise<void> {
  await alinearStoreSettings();
  await alinearPasarelas();
  await sembrarCategorias();
  await sembrarProductosDemo();
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err: unknown) => {
    console.error("[seed] fallo:", err);
    await closeDb().catch(() => {});
    // Salir con codigo != 0 para que el deploy se detenga: arrancar la tienda
    // sin store_settings es exactamente el BUG 1.
    process.exit(1);
  });
