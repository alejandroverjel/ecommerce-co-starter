import { z } from "zod";

/**
 * Validación del editor de productos.
 *
 * Este archivo lo importan el formulario (cliente) y la server action
 * (servidor), así que NO puede importar nada de `@/lib/db` ni de
 * `server-only`: se rompería el bundle del navegador. Solo Zod y funciones
 * puras.
 *
 * La regla del proyecto se cumple entera: lo que el navegador valida es
 * exactamente lo que el servidor vuelve a validar, con el mismo esquema.
 */

// ============================================================================
// Estados
// ============================================================================

/**
 * Copia de `product_status` para el cliente.
 *
 * El pgEnum es la fuente de verdad, pero importarlo aquí arrastraría
 * `drizzle-orm/pg-core` al bundle del navegador. La copia no puede
 * desincronizarse en silencio: la action asigna estos valores a
 * `products.status`, y si dejaran de ser asignables al tipo de la columna el
 * compilador falla ahí. Mismo criterio que `VALORES_FRANJA` en pedido.ts.
 */
export const VALORES_ESTADO = ["activo", "borrador", "archivado"] as const;

export type EstadoProductoValor = (typeof VALORES_ESTADO)[number];

export const ESTADOS_PRODUCTO = [
  {
    valor: "activo",
    etiqueta: "Activo",
    ayuda: "Se ve en la tienda y en Google.",
  },
  {
    valor: "borrador",
    etiqueta: "Borrador",
    ayuda: "Solo lo ves aquí. La ficha pública responde 404.",
  },
  {
    valor: "archivado",
    etiqueta: "Archivado",
    ayuda: "Retirado del catálogo. Se conserva por el historial de pedidos.",
  },
] as const satisfies readonly { valor: EstadoProductoValor; etiqueta: string; ayuda: string }[];

// ============================================================================
// Topes
// ============================================================================

/**
 * `price_cop` es un integer de Postgres: aguanta hasta 2.147.483.647. El tope
 * de aquí es muy anterior a ese límite y su trabajo es otro: atajar el dedo
 * resbalado. Cien millones ya es absurdo para un catálogo normal y casi
 * seguro un cero de más.
 */
export const PRECIO_MAXIMO_COP = 100_000_000;
export const STOCK_MAXIMO = 100_000;
export const POSICION_MAXIMA = 9_999;

// ============================================================================
// Lectura de cifras escritas por una persona
// ============================================================================

export type MotivoCifra = "vacio" | "negativo" | "decimales" | "formato";

export type LecturaCifra = {
  /** El entero, o null si no se pudo leer. */
  valor: number | null;
  motivo: MotivoCifra | null;
};

/**
 * Lee un entero de lo que una persona escribe de verdad en un campo de precio.
 *
 * Acepta "60000", "60.000", "$ 60.000", "60 000 COP", "60,000". Rechaza los
 * centavos ("60.000,50") porque el peso colombiano no los usa en retail y
 * porque toda la base guarda enteros.
 *
 * Regla para desambiguar el separador, que en Colombia es "." para miles y ","
 * para decimales, pero la gente escribe las dos: **un separador seguido de
 * exactamente tres dígitos es de miles; seguido de uno o dos, es decimal**.
 * Ningún precio colombiano tiene tres decimales, así que la regla no choca con
 * ningún caso real y hace que "60,000" y "60.000" den los dos 60000.
 */
export function analizarEntero(entrada: string): LecturaCifra {
  const bruto = (entrada ?? "").normalize("NFKC").trim();

  if (bruto === "") return { valor: null, motivo: "vacio" };

  // El signo se mira ANTES de limpiar. Si primero se quitaran los símbolos,
  // "-500" quedaría en "500" y un precio negativo entraría como positivo.
  if (bruto.includes("-") || bruto.includes("−")) {
    return { valor: null, motivo: "negativo" };
  }

  const limpio = bruto
    .replace(/[\s$]/g, "")
    .replace(/cop|pesos?|unidades?|und/gi, "");

  if (limpio === "" || !/^[\d.,]+$/.test(limpio)) {
    return { valor: null, motivo: "formato" };
  }

  const grupos = limpio.split(/[.,]/);
  if (grupos.some((g) => g === "")) return { valor: null, motivo: "formato" };

  let enteros = grupos;
  let decimales: string | null = null;

  if (grupos.length > 1) {
    const ultimo = grupos[grupos.length - 1]!;

    if (ultimo.length <= 2) {
      decimales = ultimo;
      enteros = grupos.slice(0, -1);
    } else if (ultimo.length !== 3) {
      return { valor: null, motivo: "formato" };
    }

    // Agrupación coherente: con separadores de miles, el primer grupo va de 1 a
    // 3 dígitos y los demás son de 3 exactos. Se comprueba ANTES de mirar los
    // decimales para que "12.34.56" salga como formato mal escrito y no como
    // un precio con centavos, que es lo que no es.
    if (enteros.length > 1) {
      if (enteros[0]!.length > 3) return { valor: null, motivo: "formato" };
      for (let i = 1; i < enteros.length; i++) {
        if (enteros[i]!.length !== 3) return { valor: null, motivo: "formato" };
      }
    }
  }

  // Los ceros sí pasan: "60.000,00" es un entero escrito raro. "60.000,50" es
  // dinero con centavos, que esta base no guarda y que redondear en silencio
  // sería peor que rechazar.
  if (decimales !== null && !/^0+$/.test(decimales)) {
    return { valor: null, motivo: "decimales" };
  }

  const digitos = enteros.join("");
  const valor = Number(digitos);

  if (!Number.isSafeInteger(valor)) return { valor: null, motivo: "formato" };

  return { valor, motivo: null };
}

// ============================================================================
// Campos numéricos
// ============================================================================

type MensajesCifra = Record<MotivoCifra, string> & {
  minimo: string;
  maximo: string;
};

/**
 * Campo de texto que termina siendo un entero.
 *
 * Se valida sobre la cadena y no sobre un `z.coerce.number()` porque
 * `Number("60.000")` da 60, no 60000: la coerción de JavaScript entiende el
 * punto como decimal y guardaría un producto de sesenta pesos sin avisar.
 */
function esquemaCifra(minimo: number, maximo: number, mensajes: MensajesCifra) {
  return z
    .string()
    .superRefine((texto, ctx) => {
      const { valor, motivo } = analizarEntero(texto);

      if (motivo) {
        ctx.addIssue({ code: "custom", message: mensajes[motivo] });
        return;
      }

      if (valor! < minimo) ctx.addIssue({ code: "custom", message: mensajes.minimo });
      else if (valor! > maximo) ctx.addIssue({ code: "custom", message: mensajes.maximo });
    })
    .transform((texto) => analizarEntero(texto).valor ?? 0);
}

const precioCop = esquemaCifra(1, PRECIO_MAXIMO_COP, {
  vacio: "Escribe el precio.",
  negativo: "El precio no puede ser negativo.",
  decimales: "Los precios van en pesos enteros, sin centavos.",
  formato: "Escribe solo la cifra, por ejemplo 60.000",
  minimo: "El precio tiene que ser mayor que cero. Si no se vende, desactiva la variante.",
  maximo: "Ese precio parece un cero de más. Revísalo.",
});

const stock = esquemaCifra(0, STOCK_MAXIMO, {
  vacio: "Escribe el stock. Si no queda ninguno, escribe 0.",
  negativo: "El stock no puede ser negativo.",
  decimales: "El stock son unidades enteras.",
  formato: "Escribe solo la cantidad, por ejemplo 12",
  minimo: "El stock no puede ser negativo.",
  maximo: "Ese stock parece un error de digitación.",
});

const posicion = esquemaCifra(0, POSICION_MAXIMA, {
  vacio: "Escribe la posición. El primero es 0.",
  negativo: "La posición no puede ser negativa.",
  decimales: "La posición es un número entero.",
  formato: "Escribe solo el número de orden.",
  minimo: "La posición no puede ser negativa.",
  maximo: `El máximo es ${POSICION_MAXIMA}.`,
});

/** Texto que, vacío, se guarda como NULL y no como cadena vacía. */
function textoOpcional(maximo: number, mensaje: string) {
  return z
    .string()
    .trim()
    .max(maximo, mensaje)
    .transform((v) => (v === "" ? null : v));
}

// ============================================================================
// Esquemas
// ============================================================================

export const esquemaVariante = z.object({
  id: z.string().uuid("Variante inválida"),
  /** `updated_at` en milisegundos. Ver la nota de concurrencia en la action. */
  version: z.number().int().nonnegative(),

  nombre: z
    .string()
    .trim()
    .min(1, "La variante necesita un nombre. Si es única, escribe «Única».")
    .max(80, "Nombre demasiado largo"),

  precioCop,
  stock,

  /**
   * Vacío se guarda como NULL, nunca como "". El índice único de SKU es
   * parcial (`where sku is not null`), así que dos variantes con "" chocarían
   * entre sí mientras que dos con NULL conviven sin problema.
   */
  sku: textoOpcional(64, "El SKU no puede pasar de 64 caracteres"),

  activa: z.boolean(),
});

export const esquemaProducto = z.object({
  id: z.string().uuid("Producto inválido"),
  version: z.number().int().nonnegative(),

  nombre: z
    .string()
    .trim()
    .min(3, "El nombre es muy corto")
    .max(160, "El nombre es demasiado largo"),

  /** Texto plano: alimenta el buscador y la meta description automática. */
  descripcion: textoOpcional(4_000, "La descripción es demasiado larga"),
  /** HTML que se pinta en la ficha pública. Pasa por `limpiarHtml` al guardar. */
  descripcionHtml: textoOpcional(40_000, "La descripción con formato es demasiado larga"),

  estado: z.enum(VALORES_ESTADO),
  destacado: z.boolean(),

  /** Cadena vacía = sin categoría. */
  categoriaId: z
    .union([z.string().uuid("Categoría inválida"), z.literal("")])
    .transform((v) => (v === "" ? null : v)),

  posicion,

  // Topes holgados a propósito: un catálogo importado de otra plataforma
  // puede traer títulos SEO más largos de lo recomendable, y bloquear el
  // guardado por eso impediría corregir un precio. El límite recomendado se
  // muestra como pista en el formulario, no como error.
  seoTitulo: textoOpcional(120, "El título SEO es demasiado largo"),
  seoDescripcion: textoOpcional(320, "La descripción SEO es demasiado larga"),

  variantes: z.array(esquemaVariante).max(50, "Demasiadas variantes"),
});

export type DatosProductoEditado = z.infer<typeof esquemaProducto>;
export type DatosVarianteEditada = z.infer<typeof esquemaVariante>;

/**
 * Crear un producto NUEVO, simple (una sola variante).
 *
 * Es la mayoría del catálogo de una tienda típica: un producto, un precio, un
 * stock. Los productos con varias presentaciones se crean simples y se les
 * añaden variantes después, en la ficha de edición. El slug NO se pide: se
 * genera del nombre en la action (es una URL de SEO, no algo que se teclee a
 * mano).
 */
export const esquemaCrearProducto = z.object({
  nombre: z
    .string()
    .trim()
    .min(3, "El nombre es muy corto")
    .max(160, "El nombre es demasiado largo"),
  descripcion: textoOpcional(4_000, "La descripción es demasiado larga"),
  categoriaId: z
    .union([z.string().uuid("Categoría inválida"), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  precioCop,
  stock,
  imagenUrl: textoOpcional(300, "Ruta de imagen demasiado larga"),
  estado: z.enum(VALORES_ESTADO),
  destacado: z.boolean(),
});

export type DatosCrearProducto = z.infer<typeof esquemaCrearProducto>;

/**
 * Nombre → slug de URL. Quita tildes, baja a minúsculas y une con guiones.
 * "Camiseta Básica Ñandú" → "camiseta-basica-nandu". La unicidad la resuelve
 * la action (añade sufijo si choca): aquí solo se normaliza la forma.
 */
export function generarSlug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

// ============================================================================
// Nombres de los campos del formulario
// ============================================================================

export const CAMPOS_VARIANTE = ["nombre", "precio", "stock", "sku", "activa", "version"] as const;

export type CampoVariante = (typeof CAMPOS_VARIANTE)[number];

/**
 * Nombre del input de una variante dentro del FormData.
 *
 * Lo usan el formulario para nombrar los campos y la action para leerlos y
 * para colocar los errores debajo del input correcto. Una sola función para
 * que no puedan escribirse distinto en cada lado.
 */
export function campoVariante(id: string, campo: CampoVariante): string {
  return `v_${id}_${campo}`;
}

// La limpieza del HTML de la descripción vive en `lib/admin/sanitizar.ts`
// (server-only, con sanitize-html). No va aquí porque este archivo lo importa
// el formulario del panel en el navegador, y el parser de HTML no debe entrar
// al bundle del cliente.
