import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { boolean, check, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_shared";

/**
 * ============================================================================
 * campaigns — franjas de temporada (Amor y Amistad, Navidad, San Valentin…)
 * ============================================================================
 *
 * POR QUE UNA TABLA Y NO TEXTO EN EL CODIGO
 * -----------------------------------------
 * Estas campanas se repiten cada ano y las escribe quien administra la
 * tienda, no quien programa. Si viven en el repositorio, cada temporada hay
 * que editar, compilar y desplegar para cambiar una foto; y si nadie esta
 * disponible, la campana no sale. Aqui se editan desde /admin y se encienden
 * solas.
 *
 * POR QUE NO TOCAN EL H1
 * ----------------------
 * La campana trae su propio titulo, que se pinta como H2. El H1 de la portada
 * es la senal de posicionamiento y se queda quieto todo el ano: cambiarlo
 * cada temporada reinicia lo que Google ya aprendio sobre la tienda. Por eso
 * el titulo de aqui NO se llama "h1" ni sustituye a nada, se SUMA.
 *
 * FECHAS SIN HORA, Y A PROPOSITO
 * ------------------------------
 * `date` y no `timestamptz`: nadie piensa "la campana arranca el 1 de
 * septiembre a las 00:00 hora de Bogota", piensa "durante septiembre". Guardar
 * la hora invita a errores de zona horaria en un negocio que solo opera en
 * America/Bogota. La comparacion se hace contra la fecha de Bogota, no contra
 * la del servidor (ver lib/data/campanas.ts).
 *
 * AMBOS EXTREMOS INCLUSIVE: una campana con inicio = fin dura ese dia entero,
 * que es lo que espera quien la programa para el dia de la madre.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Nombre interno para reconocerla en el panel. No se muestra al cliente. */
    name: text("name").notNull(),

    /** Titulo de la franja. Se pinta como H2, nunca como H1. */
    title: text("title").notNull(),
    body: text("body").notNull(),

    /** Ruta de la imagen, del mismo estilo que product_images.url. */
    imageUrl: text("image_url"),

    /**
     * Recorte cerrado sobre el sujeto, para movil.
     *
     * Estas fotos vienen compuestas con el sujeto a un lado y fondo liso al
     * otro. En escritorio ese hueco es donde va el texto; en movil, donde la
     * foto va arriba y entera, el mismo encuadre deja medio rectangulo vacio.
     * Si falta, se usa `image_url` y solo se pierde el encuadre.
     */
    imageMobileUrl: text("image_mobile_url"),

    imageAlt: text("image_alt"),

    /**
     * Color de la franja, en hexadecimal.
     *
     * Tapa el modulo mientras la foto carga —sin el se ve un rectangulo blanco
     * y el texto claro desaparece— y tiñe el velo que garantiza el contraste.
     * Se toma del fondo de la propia foto para que no se noten dos colores
     * distintos. Sin valor propio, usa el color primario de la tienda.
     */
    backgroundColor: text("background_color"),

    ctaLabel: text("cta_label"),
    ctaHref: text("cta_href"),

    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),

    /**
     * Interruptor manual. Con las fechas puestas no basta: hace falta poder
     * apagar una campana ya publicada sin borrarla ni tocarle las fechas —por
     * ejemplo si se agota el inventario a mitad de temporada.
     */
    enabled: boolean("enabled").notNull().default(true),

    ...timestamps,
  },
  (t) => [
    /**
     * Una campana que termina antes de empezar no se mostraria nunca y nadie
     * entenderia por que. Se rechaza al escribir, no al leer.
     */
    check("campaigns_rango_ck", sql`${t.endsOn} >= ${t.startsOn}`),

    check("campaigns_title_ck", sql`length(btrim(${t.title})) > 0`),

    /**
     * El color se interpola dentro de un `linear-gradient`. Aceptar texto
     * libre dejaria que un valor con parentesis o punto y coma se colara en la
     * hoja de estilos; el patron lo restringe a un hexadecimal.
     */
    check(
      "campaigns_color_ck",
      sql`${t.backgroundColor} is null or ${t.backgroundColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),

    /**
     * El CTA es todo o nada: un boton con texto y sin destino no lleva a
     * ninguna parte, y un destino sin texto no se puede pulsar.
     */
    check(
      "campaigns_cta_ck",
      sql`(${t.ctaLabel} is null) = (${t.ctaHref} is null)`,
    ),

    /** La consulta de portada filtra por fechas en cada visita. */
    index("campaigns_vigencia_idx").on(t.startsOn, t.endsOn),
  ],
);

export type Campaign = InferSelectModel<typeof campaigns>;
export type NuevaCampaign = InferInsertModel<typeof campaigns>;
