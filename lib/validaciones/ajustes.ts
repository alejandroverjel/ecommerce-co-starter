import { z } from "zod";

import { leerImporte } from "@/lib/dinero";
import type { PaymentGateway, UserRole } from "@/lib/db/schema/enums";

/**
 * Validación de los ajustes de la tienda, las pasarelas y los roles.
 *
 * Todo lo de aquí corre en el SERVIDOR aunque el formulario también lo use
 * para pintar el ejemplo en vivo: una server action es un endpoint POST y se
 * puede llamar sin pasar por la página.
 *
 * Los valores de los enums se declaran a mano y se contrastan con `satisfies`
 * contra los tipos derivados de los pgEnum. Así este módulo no arrastra
 * drizzle al bundle del navegador, pero si alguien añade un rol o una pasarela
 * en la base, esto deja de compilar.
 */

export const ROLES = ["admin", "staff", "cliente"] as const satisfies readonly UserRole[];

export const PASARELAS = [
  "wompi",
  "epayco",
  "mercadopago",
] as const satisfies readonly PaymentGateway[];

/**
 * Las únicas pasarelas que el checkout sabe cobrar.
 *
 * `payment_gateways` tiene tres filas, pero encender una que ningún código
 * sabe procesar pondría un método de pago que deja el pedido pendiente para
 * siempre con el cliente creyendo que pagó. ePayco no está integrada.
 */
export const PASARELAS_INTEGRADAS = [
  "mercadopago",
  "wompi",
] as const satisfies readonly PaymentGateway[];

export type PasarelaIntegrada = (typeof PASARELAS_INTEGRADAS)[number];

export function estaIntegrada(pasarela: string): pasarela is PasarelaIntegrada {
  return (PASARELAS_INTEGRADAS as readonly string[]).includes(pasarela);
}

/**
 * Cómo se llaman las llaves de cada pasarela y cómo se distingue producción de
 * pruebas. Cada proveedor tiene su convención y aplicarle la de otro rechaza
 * llaves buenas.
 *
 * `entorno` devuelve null cuando la llave no dice nada reconocible: en ese caso
 * no se opina, mejor que inventar un error.
 */
type ConvencionLlave = {
  prefijoPublica: string | null;
  prefijoPrivada: string | null;
  /** ¿El cobro se inicia en el navegador con la llave pública? */
  exigeLlavePublica: boolean;
  entorno: (llave: string | null) => "pruebas" | "produccion" | null;
};

export const CONVENCIONES_LLAVE: Record<(typeof PASARELAS)[number], ConvencionLlave> = {
  // Wompi: pub_test_xxx / prv_prod_xxx. El checkout hospedado se abre con una
  // URL firmada que lleva la llave pública, así que es obligatoria.
  wompi: {
    prefijoPublica: "pub_",
    prefijoPrivada: "prv_",
    exigeLlavePublica: true,
    entorno: (l) =>
      l?.includes("_test_") ? "pruebas" : l?.includes("_prod_") ? "produccion" : null,
  },

  // Mercado Pago: el prefijo YA NO distingue el entorno. Las cuentas nuevas
  // emiten también las credenciales DE PRUEBA con APP_USR- (salen de una
  // "aplicación de prueba" propia); solo las cuentas viejas conservan TEST-.
  // Afirmar "APP_USR- es producción" bloqueaba guardar unas llaves de prueba
  // legítimas con la casilla de pruebas marcada — verificado con la cuenta
  // real de la tienda. TEST- sí sigue siendo inequívocamente de pruebas; con
  // APP_USR- no se opina.
  mercadopago: {
    prefijoPublica: null,
    prefijoPrivada: null,
    exigeLlavePublica: false,
    entorno: (l) => (l?.startsWith("TEST-") ? "pruebas" : null),
  },

  // No integrada; se declara para que el Record esté completo y el panel no
  // reviente si alguien abre su tarjeta.
  epayco: {
    prefijoPublica: null,
    prefijoPrivada: null,
    exigeLlavePublica: true,
    entorno: () => null,
  },
};

/**
 * Etiquetas de los campos de llaves, por pasarela.
 *
 * El formulario era Wompi puro ("Empieza por prv_", "Secreto de integridad").
 * En Mercado Pago esos mismos campos son otra cosa: la llave privada es el
 * Access Token y el secreto de integridad no existe. Un campo mal rotulado
 * hace que alguien pegue la llave equivocada, y eso son cobros que no entran.
 */
export type EtiquetasPasarela = {
  llavePublica: { etiqueta: string; ayuda: string } | null;
  llavePrivada: { etiqueta: string; ayuda: string };
  secretoEventos: { etiqueta: string; ayuda: string };
  secretoIntegridad: { etiqueta: string; ayuda: string } | null;
  /** Dónde encontrar las llaves, para no tener que buscarlo cada vez. */
  donde: string | null;
};

export const ETIQUETAS_PASARELA: Record<(typeof PASARELAS)[number], EtiquetasPasarela> = {
  wompi: {
    llavePublica: {
      etiqueta: "Llave pública",
      ayuda: "Empieza por pub_. Viaja al navegador en el checkout, así que no es secreta.",
    },
    llavePrivada: {
      etiqueta: "Llave privada",
      ayuda: "Empieza por prv_. Firma las peticiones a la pasarela.",
    },
    secretoEventos: {
      etiqueta: "Secreto de eventos",
      ayuda: "Verifica la firma de los webhooks. Sin esto, cualquiera puede fingir un pago.",
    },
    secretoIntegridad: {
      etiqueta: "Secreto de integridad",
      ayuda: "Firma el monto del checkout para que no se pueda alterar por la URL.",
    },
    donde: "Wompi → Desarrolladores → Llaves de API.",
  },

  mercadopago: {
    llavePublica: {
      etiqueta: "Public Key (opcional)",
      ayuda:
        "APP_USR-… o TEST-…. Checkout Pro no la necesita; se guarda por si algún día se usa un formulario embebido.",
    },
    llavePrivada: {
      etiqueta: "Access Token",
      ayuda:
        "APP_USR-… o TEST-…. Es lo que autentica el cobro contra Mercado Pago. Imprescindible.",
    },
    secretoEventos: {
      etiqueta: "Clave secreta del webhook",
      ayuda:
        "La que da Mercado Pago al configurar la notificación. Verifica la firma: sin esto, cualquiera puede fingir un pago.",
    },
    // Mercado Pago no tiene equivalente: el monto va dentro de la preferencia
    // creada por API, no en una URL que el cliente pueda editar.
    secretoIntegridad: null,
    donde:
      "Mercado Pago → Tus integraciones → tu aplicación → Credenciales de producción (y Webhooks para la clave secreta).",
  },

  epayco: {
    llavePublica: { etiqueta: "Llave pública", ayuda: "" },
    llavePrivada: { etiqueta: "Llave privada", ayuda: "" },
    secretoEventos: { etiqueta: "Secreto de eventos", ayuda: "" },
    secretoIntegridad: { etiqueta: "Secreto de integridad", ayuda: "" },
    donde: null,
  },
};

// ============================================================================
// Piezas reutilizables
// ============================================================================

/** Importe en pesos enteros, leído como lo escribe una persona: "12.000". */
function importe(etiqueta: string) {
  return z.string().transform((valor, ctx) => {
    const lectura = leerImporte(valor);
    if (!lectura.ok) {
      ctx.addIssue({ code: "custom", message: `${etiqueta} — ${lectura.error}` });
      return z.NEVER;
    }
    return lectura.pesos;
  });
}

/**
 * Campo de secreto: vacío significa "déjalo como está", no "bórralo".
 *
 * Es la diferencia entre guardar el formulario para cambiar el nombre de la
 * tienda y quedarse sin poder cobrar.
 */
function secreto(etiqueta: string) {
  return z
    .string()
    .transform((v) => v.trim())
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || v.length >= 12, `${etiqueta} — parece incompleta`)
    .refine((v) => v === null || v.length <= 400, `${etiqueta} — demasiado larga`);
}

// ============================================================================
// A) store_settings
// ============================================================================

export const esquemaAjustesTienda = z.object({


  /** Nullable en la base: hay tiendas que solo atienden por WhatsApp. */

  /**
   * Se guarda con indicativo y sin signos porque así lo consume el enlace
   * wa.me. Quien lo escribe suele poner solo los diez dígitos del celular.
   */

  envioPlanoCop: importe("Envío"),

  umbralEnvioGratisCop: importe("Envío gratis desde").refine(
    (v) => v > 0,
    "Un umbral de 0 dejaría TODOS los envíos gratis. Si es lo que quieres, pon el envío en 0 y el umbral bien alto.",
  ),

  /**
   * Menos de cinco minutos no alcanza para llenar el checkout, y la reserva
   * se soltaría con el cliente escribiendo la dirección.
   */
  minutosReserva: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v), "Los minutos de reserva son un número entero")
    .transform(Number)
    .refine((v) => v >= 5, "La reserva no puede durar menos de 5 minutos")
    .refine((v) => v <= 240, "La reserva no puede durar más de 4 horas"),
});

export type AjustesTiendaValidados = z.output<typeof esquemaAjustesTienda>;

// ============================================================================
// B) payment_gateways
// ============================================================================

export const esquemaPasarela = z
  .object({
    pasarela: z.enum(PASARELAS, { message: "Pasarela desconocida" }),
    habilitada: z.boolean(),
    pruebas: z.boolean(),

    llavePublica: z
      .string()
      .trim()
      .max(300, "La llave pública es demasiado larga")
      .transform((v) => (v === "" ? null : v)),

    llavePrivada: secreto("Llave privada"),
    secretoEventos: secreto("Secreto de eventos"),
    secretoIntegridad: secreto("Secreto de integridad"),

    borrarSecretos: z.boolean(),
  })
  .superRefine((d, ctx) => {
    /**
     * Las convenciones de nombre son POR PASARELA, no universales.
     *
     * Wompi usa `pub_test_` / `prv_prod_`; Mercado Pago usa `APP_USR-` para
     * producción y `TEST-` para pruebas, y su token de servidor no lleva
     * ningún prefijo que lo distinga de la llave pública salvo eso. Aplicar
     * las reglas de Wompi a MP rechazaría llaves buenas, así que cada una
     * declara las suyas.
     */
    const convenciones = CONVENCIONES_LLAVE[d.pasarela];

    // Confundir los dos campos publica la llave privada en el HTML del
    // checkout. Es el error que más caro sale y el prefijo lo delata.
    if (convenciones.prefijoPrivada && d.llavePublica?.startsWith(convenciones.prefijoPrivada)) {
      ctx.addIssue({
        code: "custom",
        path: ["llavePublica"],
        message: `Eso es una llave PRIVADA (${convenciones.prefijoPrivada}). La pública empieza por ${convenciones.prefijoPublica}.`,
      });
    }

    if (convenciones.prefijoPublica && d.llavePrivada?.startsWith(convenciones.prefijoPublica)) {
      ctx.addIssue({
        code: "custom",
        path: ["llavePrivada"],
        message: `Eso es la llave pública (${convenciones.prefijoPublica}). La privada empieza por ${convenciones.prefijoPrivada}.`,
      });
    }

    // Cobrar en producción con llaves de prueba deja pedidos pagados que el
    // banco nunca vio; al revés, cobra de verdad mientras se hacen pruebas.
    for (const [campo, llave] of [
      ["llavePublica", d.llavePublica],
      ["llavePrivada", d.llavePrivada],
    ] as const) {
      const e = convenciones.entorno(llave);
      if (e === "produccion" && d.pruebas) {
        ctx.addIssue({
          code: "custom",
          path: [campo],
          message: "Esa llave es de producción y la pasarela está en modo pruebas.",
        });
      }
      if (e === "pruebas" && !d.pruebas) {
        ctx.addIssue({
          code: "custom",
          path: [campo],
          message: "Esa llave es de pruebas y la pasarela está en modo producción.",
        });
      }
    }

    /**
     * Qué hace falta para poder cobrar depende de cómo inicie el cobro cada
     * pasarela. Wompi arma una URL firmada en el navegador y necesita la llave
     * pública; Mercado Pago crea la preferencia por API desde el servidor y lo
     * que necesita es el ACCESS TOKEN. Exigir llave pública a MP bloquearía
     * una configuración perfectamente válida.
     */
    if (d.habilitada && convenciones.exigeLlavePublica && !d.llavePublica) {
      ctx.addIssue({
        code: "custom",
        path: ["llavePublica"],
        message: "Sin llave pública la pasarela no puede abrir el checkout.",
      });
    }

    if (d.borrarSecretos && (d.llavePrivada || d.secretoEventos || d.secretoIntegridad)) {
      ctx.addIssue({
        code: "custom",
        path: ["borrarSecretos"],
        message: "O borras los secretos guardados o escribes unos nuevos, no las dos cosas.",
      });
    }
  });

export type PasarelaValidada = z.output<typeof esquemaPasarela>;

// ============================================================================
// C) Roles
// ============================================================================

export const esquemaCambioRol = z.object({
  usuarioId: z.string().uuid("Esa cuenta no existe"),
  rol: z.enum(ROLES, { message: "Ese rol no existe" }),
});

export type CambioRolValidado = z.output<typeof esquemaCambioRol>;
