/**
 * Único archivo que se edita para una tienda nueva; el dinero editable vive
 * en /admin/ajustes.
 *
 * Solo admite constantes y `process.env.NEXT_PUBLIC_*`. Sin imports, sin
 * alias `@/` y sin `server-only`, para que lo puedan importar componentes
 * cliente, lib/stores/carrito.ts, lib/db/seed.ts (empaquetado con esbuild) y,
 * si hace falta, next.config.ts por ruta relativa.
 *
 * Reparto de datos: la identidad y la operación viven aquí. El dinero
 * editable (envío, umbral de envío gratis, IVA, minutos de reserva) vive en
 * la tabla `store_settings`; `envioInicial` de abajo es solo el valor de
 * fábrica que siembra la migración 0002 y que el seed alinea mientras nadie
 * lo edite en el panel.
 */

type DiaSemana =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

type RedSocial = "Instagram" | "Facebook" | "YouTube" | "TikTok" | "Google";

export type ConfigTienda = {
  /** Nombre visible de la tienda. */
  nombre: string;
  /** Identificador corto de la tienda. Minúsculas, números y guiones. */
  slug: string;
  descripcion: string;
  seo: {
    tituloPorDefecto: string;
    keywords: string[];
    /** Se agrega al nombre del producto en el <title> de la ficha. */
    sufijoProducto: string | null;
    /** Hex. Va en <meta name="theme-color">. */
    colorTema: string;
    /** Rango de precios para los datos estructurados, p. ej. "$$". */
    priceRange: string | null;
  };
  marca: {
    /** Ruta bajo /public. Si es null, se pinta el nombre en texto. */
    logo: string | null;
    /** Logo para los correos transaccionales (no soportan SVG/WebP). */
    logoCorreo: string | null;
    /** Imagen de previsualización al compartir el enlace. 1200x630. */
    imagenCompartir: string | null;
  };
  ubicacion: {
    ciudad: string;
    departamento: string;
    pais: "CO";
    idioma: "es-CO";
    moneda: "COP";
    zonaHoraria: "America/Bogota";
  };
  contacto: {
    /** 10 dígitos nacionales, sin indicativo. Null oculta el teléfono. */
    telefono: string | null;
    /** 10 dígitos nacionales. Se deriva 57XXXXXXXXXX. Null oculta WhatsApp. */
    whatsapp: string | null;
    mensajeWhatsapp: string;
    correo: string;
  };
  redes: { nombre: RedSocial; url: string }[];
  /** Enlace a la ficha de Google del negocio (por CID). Null si no hay. */
  googleFicha: string | null;
  horarioAtencion: {
    etiqueta: string;
    dias: DiaSemana[];
    abre: string;
    cierra: string;
  }[];
  cobertura: {
    descripcion: string;
    municipios: readonly [string, ...string[]];
  };
  entregas: {
    /**
     * De 1 a 3 franjas, valores únicos, subconjunto de los tres que permite
     * el CHECK `orders_delivery_slot_ck` de la base. Agregar una franja nueva
     * (distinta de manana/tarde/noche) exige una migración.
     */
    franjas: readonly {
      valor: "manana" | "tarde" | "noche";
      etiqueta: string;
      desde: string;
      hasta: string;
      corteMin: number;
    }[];
    diasEntrega: DiaSemana[];
    diasMaximos: number;
    tiempoPreparacionDias: [number, number];
    tiempoTransitoDias: [number, number];
    permitirHora: boolean;
    horasAntelacionCambio: number;
  };
  checkout: {
    /** Si es false, el destinatario es el comprador y no se pide aparte. */
    destinatarioDistinto: boolean;
    mensajeRegalo: boolean;
    maxMensaje: number;
    maxUnidadesPorProducto: number;
    aviso: string | null;
  };
  producto: {
    aviso: string | null;
    textoDisponible: string;
  };
  catalogo: {
    ordenPorDefecto: "precio-asc" | "precio-desc" | "curado";
    /** Vacío = sin filtro de categoría en las sugerencias cruzadas. */
    categoriasCrossSell: string[];
    /** Las siembra lib/db/seed.ts con ON CONFLICT DO NOTHING. */
    categoriasIniciales: { slug: string; nombre: string; descripcion?: string }[];
  };
  /**
   * Valores de fábrica para `store_settings`. Enteros; envío y umbral >= 0,
   * IVA en puntos básicos (0-10000), minutos > 0. Sin null: la columna es
   * NOT NULL y calcularEnvio da envío gratis con umbral 0. Para "sin envío
   * gratis" se usa un umbral muy alto (p. ej. 999999999).
   */
  envioInicial: {
    envioPlanoCop: number;
    umbralEnvioGratisCop: number;
    ivaBps: number;
    minutosReserva: number;
  };
  pagos: {
    /** <=13 caracteres, mayúsculas, sin tildes. */
    descriptorExtracto: string;
  };
  legal: {
    actualizado: string;
    razonSocial: string | null;
    nit: string | null;
    domicilio: string;
    descripcionCatalogo: string;
    plazoReporteDias: number;
    plazoRespuestaReclamoHoras: number;
    plazoReembolsoDiasHabiles: number;
    exceptuaRetracto: boolean;
  };
  /** La clave "envio" recibe las cifras vivas de store_settings. */
  preguntas: { clave: string; p: string; r: string }[];
  correo: {
    colorPrimario: string;
    colorTexto: string;
    colorSuave: string;
  };
  campanas: {
    diasCuentaRegresiva: number;
  };
};

export const TIENDA = {
  nombre: "Mi Tienda",
  slug: "mi-tienda",
  descripcion: "Tienda en línea con envíos a domicilio.",
  seo: {
    tituloPorDefecto: "Mi Tienda · Compra en línea",
    keywords: [],
    sufijoProducto: null,
    colorTema: "#ffffff",
    priceRange: "$$",
  },
  marca: {
    logo: null,
    logoCorreo: null,
    imagenCompartir: null,
  },
  ubicacion: {
    ciudad: "Bogotá",
    departamento: "Cundinamarca",
    pais: "CO",
    idioma: "es-CO",
    moneda: "COP",
    zonaHoraria: "America/Bogota",
  },
  contacto: {
    telefono: "3000000000",
    whatsapp: null,
    mensajeWhatsapp: "Hola, tengo una pregunta sobre un producto",
    correo: "hola@example.com",
  },
  // Cast explícito: sin él, un arreglo vacío bajo "as const" queda tipado
  // como tupla vacía y cualquier .find()/.map() aguas abajo da "never".
  redes: [] as { nombre: RedSocial; url: string }[],
  googleFicha: null,
  horarioAtencion: [
    {
      etiqueta: "Lunes a viernes",
      dias: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      abre: "09:00",
      cierra: "18:00",
    },
  ],
  cobertura: {
    descripcion: "Bogotá y municipios cercanos",
    municipios: ["Bogotá", "Chía", "Soacha"],
  },
  entregas: {
    franjas: [
      { valor: "manana", etiqueta: "Mañana (9:00 a 13:00)", desde: "09:00", hasta: "13:00", corteMin: 720 },
      { valor: "tarde", etiqueta: "Tarde (13:00 a 18:00)", desde: "13:00", hasta: "18:00", corteMin: 1020 },
    ],
    diasEntrega: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    diasMaximos: 60,
    tiempoPreparacionDias: [0, 1],
    tiempoTransitoDias: [1, 3],
    permitirHora: false,
    horasAntelacionCambio: 24,
  },
  checkout: {
    destinatarioDistinto: false,
    mensajeRegalo: false,
    maxMensaje: 300,
    maxUnidadesPorProducto: 20,
    aviso: null,
  },
  producto: {
    aviso: null,
    textoDisponible: "Disponible",
  },
  catalogo: {
    ordenPorDefecto: "curado",
    categoriasCrossSell: [],
    categoriasIniciales: [{ slug: "general", nombre: "General" }],
  },
  envioInicial: {
    envioPlanoCop: 10000,
    umbralEnvioGratisCop: 200000,
    ivaBps: 1900,
    minutosReserva: 15,
  },
  pagos: {
    descriptorExtracto: "MITIENDA",
  },
  legal: {
    actualizado: "2026-01-01",
    razonSocial: null,
    nit: null,
    domicilio: "Bogotá, Colombia",
    descripcionCatalogo: "Productos de nuestro catálogo en línea.",
    plazoReporteDias: 2,
    plazoRespuestaReclamoHoras: 48,
    plazoReembolsoDiasHabiles: 10,
    exceptuaRetracto: false,
  },
  preguntas: [
    { clave: "envio", p: "¿Cuánto cuesta el envío?", r: "" },
    { clave: "pagos", p: "¿Qué medios de pago aceptan?", r: "Tarjeta y PSE a través de pasarelas seguras." },
  ],
  correo: {
    colorPrimario: "#111827",
    colorTexto: "#111827",
    colorSuave: "#6b7280",
  },
  campanas: {
    diasCuentaRegresiva: 30,
  },
} as const satisfies ConfigTienda;
