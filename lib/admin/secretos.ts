import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { paymentGateways } from "@/lib/db/schema";
import type { PaymentGateway } from "@/lib/db/schema/enums";

/**
 * ============================================================================
 * Secretos de pasarela
 * ============================================================================
 *
 * DECISIÓN: la llave privada NUNCA vuelve al navegador, ni truncada por la
 * mitad, ni "solo para mostrarla una vez".
 *
 * El panel enseña dos cosas de cada secreto: si está puesto y una PISTA con el
 * prefijo del proveedor y los últimos cuatro caracteres (`prv_prod_••••4f2a`).
 * Con eso alguien confirma que la llave que guardó es la que quería, que es lo
 * único para lo que sirve verla, y esos cuatro caracteres no acercan a nadie a
 * adivinar el resto. Es lo mismo que hace la consola de AWS con las suyas.
 *
 * El campo del formulario es de ESCRITURA: vacío quiere decir "déjala como
 * está". Nunca se rellena con el valor actual, así que ni el HTML de la página
 * ni el historial del navegador ni una captura de pantalla lo contienen.
 *
 * En la base va CIFRADO con AES-256-GCM. Un `pg_dump` es un archivo que se
 * copia a un portátil, se sube a un bucket y se pasa por WhatsApp; una llave
 * que mueve dinero no puede viajar en texto plano dentro de él. La llave
 * maestra vive en el entorno del contenedor (PAYMENT_SECRETS_ENCRYPTION_KEY),
 * o sea en otro sitio distinto del respaldo: hay que robar los dos.
 *
 * GCM y no CBC porque autentica: si alguien edita el texto cifrado con un
 * UPDATE a mano, el descifrado falla en vez de devolver basura.
 *
 * Sin PAYMENT_SECRETS_ENCRYPTION_KEY no se guarda nada. Falla cerrado a
 * propósito: guardar en claro "porque no había llave" es exactamente el
 * accidente del que esto protege.
 */

const ALGORITMO = "aes-256-gcm";
const BYTES_IV = 12;

/** Los tres secretos de Wompi. `public_key` no está: esa es pública. */
export const NOMBRES_SECRETO = [
  "llavePrivada",
  "secretoEventos",
  "secretoIntegridad",
] as const;

export type NombreSecreto = (typeof NOMBRES_SECRETO)[number];

export type SecretoGuardado = {
  /** Sobre "v1.iv.tag.cifrado", todo en base64. */
  sobre: string;
  /** Lo único que puede ver el navegador. */
  pista: string;
  /** ISO. Sirve para saber cuándo se rotó por última vez. */
  actualizado: string;
};

export type ConfigPasarela = {
  secretos?: Partial<Record<NombreSecreto, SecretoGuardado>>;
  [clave: string]: unknown;
};

/**
 * Variables de entorno de las que se leía cada secreto antes de que el panel
 * pudiera guardarlos. Se mantienen como RESPALDO para que la tienda siga
 * cobrando entre el despliegue de esta pantalla y el momento en que alguien
 * escriba las llaves; en cuanto hay valor en la base, manda la base.
 */
const VARIABLES_ENTORNO: Partial<Record<PaymentGateway, Record<NombreSecreto, string>>> = {
  wompi: {
    llavePrivada: "WOMPI_PRIVATE_KEY",
    secretoEventos: "WOMPI_EVENTS_SECRET",
    secretoIntegridad: "WOMPI_INTEGRITY_SECRET",
  },
  mercadopago: {
    // En Mercado Pago la "llave privada" del modelo es el ACCESS TOKEN, que es
    // lo que autentica las llamadas a su API.
    llavePrivada: "MERCADOPAGO_ACCESS_TOKEN",
    secretoEventos: "MERCADOPAGO_WEBHOOK_SECRET",
    // No existe equivalente: el monto viaja dentro de la preferencia creada
    // por API, no en una URL que el cliente pueda editar.
    secretoIntegridad: "",
  },
};

function llaveMaestra(): Buffer {
  const cruda = process.env.PAYMENT_SECRETS_ENCRYPTION_KEY;
  if (!cruda) {
    throw new Error(
      "Falta PAYMENT_SECRETS_ENCRYPTION_KEY. Generar con `openssl rand -base64 32` " +
        "y ponerla en el entorno del contenedor antes de guardar llaves de pasarela.",
    );
  }

  const llave = Buffer.from(cruda, "base64");
  if (llave.length !== 32) {
    throw new Error(
      `PAYMENT_SECRETS_ENCRYPTION_KEY debe ser de 32 bytes en base64; llegaron ${llave.length}.`,
    );
  }

  return llave;
}

export function hayLlaveMaestra(): boolean {
  try {
    llaveMaestra();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pista mostrable: prefijo del proveedor (que ya es público, va en la
 * documentación de Wompi) y los últimos cuatro caracteres.
 */
export function pistaDe(valor: string): string {
  // Wompi: pub_test_ / prv_prod_. Mercado Pago: APP_USR- / TEST-.
  const prefijo = /^((pub|prv)_(test|prod)_|APP_USR-|TEST-)/.exec(valor)?.[0] ?? "";
  const cola = valor.slice(-4);
  return `${prefijo}••••${cola}`;
}

/**
 * Dato asociado (AAD) que ata cada sobre a SU campo y SU pasarela.
 *
 * Sin esto, los tres secretos de una pasarela se cifran con la misma llave y
 * son intercambiables: quien tenga UPDATE sobre `payment_gateways` puede mover
 * el sobre de `secretoEventos` al campo `llavePrivada` y GCM lo descifra tan
 * contento, porque criptográficamente es válido. Con el AAD, el descifrado de
 * un sobre movido de sitio FALLA.
 */
function contexto(pasarela: PaymentGateway, nombre: NombreSecreto): Buffer {
  return Buffer.from(`${pasarela}:${nombre}`, "utf8");
}

export function cifrarSecreto(
  valor: string,
  pasarela: PaymentGateway,
  nombre: NombreSecreto,
): SecretoGuardado {
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, llaveMaestra(), iv);
  cifrador.setAAD(contexto(pasarela, nombre));

  const cifrado = Buffer.concat([cifrador.update(valor, "utf8"), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();

  // v2 = con AAD. Los sobres v1 (sin AAD) se siguen leyendo, ver descifrar.
  return {
    sobre: `v2.${iv.toString("base64")}.${etiqueta.toString("base64")}.${cifrado.toString("base64")}`,
    pista: pistaDe(valor),
    actualizado: new Date().toISOString(),
  };
}

export function descifrarSecreto(
  guardado: SecretoGuardado,
  pasarela: PaymentGateway,
  nombre: NombreSecreto,
): string {
  const [version, iv, etiqueta, cifrado] = guardado.sobre.split(".");
  if ((version !== "v1" && version !== "v2") || !iv || !etiqueta || !cifrado) {
    throw new Error("Secreto de pasarela con formato desconocido.");
  }

  const descifrador = createDecipheriv(
    ALGORITMO,
    llaveMaestra(),
    Buffer.from(iv, "base64"),
  );
  // v1 son los sobres anteriores al AAD: se leen tal cual para no dejar
  // inservible lo ya guardado. Al reescribirlos suben solos a v2.
  if (version === "v2") descifrador.setAAD(contexto(pasarela, nombre));
  descifrador.setAuthTag(Buffer.from(etiqueta, "base64"));

  return Buffer.concat([
    descifrador.update(Buffer.from(cifrado, "base64")),
    descifrador.final(),
  ]).toString("utf8");
}

/**
 * El secreto en claro, para quien va a llamar a la pasarela.
 *
 * SOLO servidor, y el valor no se devuelve nunca a un componente que se
 * renderice: se usa para firmar la petición y se descarta.
 */
export async function leerSecretoPasarela(
  pasarela: PaymentGateway,
  nombre: NombreSecreto,
): Promise<string | null> {
  const filas = await db
    .select({ config: paymentGateways.config })
    .from(paymentGateways)
    .where(eq(paymentGateways.gateway, pasarela))
    .limit(1);

  const guardado = (filas[0]?.config as ConfigPasarela | null)?.secretos?.[nombre];
  if (guardado) return descifrarSecreto(guardado, pasarela, nombre);

  const variable = VARIABLES_ENTORNO[pasarela]?.[nombre];
  return (variable && process.env[variable]) || null;
}
