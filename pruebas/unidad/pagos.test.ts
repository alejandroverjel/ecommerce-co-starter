import { createHash, createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
  aEstadoPago,
  firmaMercadoPagoEsValida,
  lineasParaPreferencia,
} from "@/lib/pagos/mercadopago-puro";
import { aCentavos, eventoWompiEsAutentico } from "@/lib/pagos/wompi-firma";
import { firmarRecibo, leerReciboFirmado } from "@/lib/pagos/recibo";

/**
 * Lo que decide si un pago es real y por cuánto.
 *
 * La firma del webhook es lo único que separa "la pasarela dice que pagaron"
 * de "alguien hizo un POST a una URL pública", así que cada forma de evadirla
 * tiene su caso.
 *
 * Se importan los módulos puros (`mercadopago-puro`, `wompi-firma`): no tienen
 * `import "server-only"` ni tocan `@/lib/db`, y `lib/pagos/mercadopago.ts` y
 * `lib/pagos/wompi.ts` los re-exportan. Esta prueba no puede importar nada que
 * cargue `lib/db`: correría solo con DATABASE_URL.
 */

const SECRETO = "clave-secreta-de-prueba";
const ID = "123456789";
const REQ = "req-abc-123";

function firmar(id: string, req: string, ts: number, secreto = SECRETO): string {
  return createHmac("sha256", secreto)
    .update(`id:${id.toLowerCase()};request-id:${req};ts:${ts};`)
    .digest("hex");
}

const ahora = () => Math.floor(Date.now() / 1000);

describe("firma del webhook de Mercado Pago", () => {
  it("acepta una firma legítima", () => {
    const ts = ahora();
    expect(firmaMercadoPagoEsValida(`ts=${ts},v1=${firmar(ID, REQ, ts)}`, REQ, ID, SECRETO)).toBe(true);
  });

  it("rechaza si el secreto no es el nuestro", () => {
    const ts = ahora();
    const ajena = firmar(ID, REQ, ts, "otro-secreto");
    expect(firmaMercadoPagoEsValida(`ts=${ts},v1=${ajena}`, REQ, ID, SECRETO)).toBe(false);
  });

  it("rechaza si cambian el id del pago manteniendo la firma", () => {
    const ts = ahora();
    const firma = firmar(ID, REQ, ts);
    expect(firmaMercadoPagoEsValida(`ts=${ts},v1=${firma}`, REQ, "999999", SECRETO)).toBe(false);
  });

  it("rechaza un replay: firma válida pero vieja", () => {
    // Una notificación capturada hace una hora no puede reinyectarse.
    const viejo = ahora() - 3600;
    expect(
      firmaMercadoPagoEsValida(`ts=${viejo},v1=${firmar(ID, REQ, viejo)}`, REQ, ID, SECRETO),
    ).toBe(false);
  });

  it("rechaza cabeceras ausentes o malformadas", () => {
    const ts = ahora();
    expect(firmaMercadoPagoEsValida(null, REQ, ID, SECRETO)).toBe(false);
    expect(firmaMercadoPagoEsValida("basura", REQ, ID, SECRETO)).toBe(false);
    expect(firmaMercadoPagoEsValida(`ts=${ts}`, REQ, ID, SECRETO)).toBe(false);
    expect(firmaMercadoPagoEsValida(`ts=${ts},v1=${firmar(ID, REQ, ts)}`, REQ, "", SECRETO)).toBe(false);
  });

  it("normaliza a minúsculas los ids alfanuméricos, como hace MP", () => {
    const ts = ahora();
    expect(
      firmaMercadoPagoEsValida(`ts=${ts},v1=${firmar("ABC-9", REQ, ts)}`, REQ, "ABC-9", SECRETO),
    ).toBe(true);
  });
});

describe("estados de Mercado Pago", () => {
  it("traduce solo lo que entiende", () => {
    expect(aEstadoPago("approved")).toBe("aprobado");
    expect(aEstadoPago("rejected")).toBe("rechazado");
    expect(aEstadoPago("cancelled")).toBe("rechazado");
    expect(aEstadoPago("refunded")).toBe("reembolsado");
    expect(aEstadoPago("charged_back")).toBe("reembolsado");
    expect(aEstadoPago("pending")).toBe("pendiente");
    expect(aEstadoPago("in_process")).toBe("pendiente");
  });

  it("un estado desconocido devuelve null en vez de adivinar", () => {
    // Si MP inventa un estado nuevo, el pedido NO se toca.
    expect(aEstadoPago("marciano")).toBeNull();
    expect(aEstadoPago("")).toBeNull();
  });
});

describe("lo que se le cobra al cliente en Mercado Pago", () => {
  const items = [
    { titulo: "Producto A", cantidad: 1, precioCop: 86_000 },
    { titulo: "Producto B", cantidad: 2, precioCop: 7_000 },
  ];
  const suma = (r: { lineas: typeof items; envioCop: number }) =>
    r.lineas.reduce((s, l) => s + l.precioCop * l.cantidad, 0) + r.envioCop;

  it("manda el desglose cuando cuadra con el total", () => {
    const r = lineasParaPreferencia(items, 12_000, 112_000, "ORD-1");
    expect(r.lineas).toHaveLength(2);
    expect(suma(r)).toBe(112_000);
  });

  it("con un cupón aplicado colapsa en una línea por el total", () => {
    // MP no tiene campo de descuento: mandar el desglose cobraría de más.
    const r = lineasParaPreferencia(items, 12_000, 92_000, "ORD-2");
    expect(r.lineas).toHaveLength(1);
    expect(suma(r)).toBe(92_000);
  });

  it("NUNCA cobra algo distinto del total del pedido", () => {
    for (const total of [1_000, 92_000, 112_000, 999_999]) {
      expect(suma(lineasParaPreferencia(items, 12_000, total, "ORD-X"))).toBe(total);
    }
  });

  it("un carrito sin líneas no rompe: cobra el total", () => {
    const r = lineasParaPreferencia([], 0, 50_000, "ORD-3");
    expect(suma(r)).toBe(50_000);
  });
});

describe("aCentavos (Wompi)", () => {
  it("COP no tiene centavos, Wompi cobra en la subunidad: x100", () => {
    expect(aCentavos(12_345)).toBe(1_234_500);
  });
});

describe("firma de eventos de Wompi", () => {
  const SECRETO_EVENTOS = "secreto-eventos-de-prueba";
  const TIMESTAMP = 1_700_000_000;

  function valorPorRuta(raiz: unknown, ruta: string): string {
    let actual: unknown = raiz;
    for (const parte of ruta.split(".")) {
      if (typeof actual !== "object" || actual === null) return "";
      actual = (actual as Record<string, unknown>)[parte];
    }
    return actual === undefined || actual === null ? "" : String(actual);
  }

  function evento(amountInCents: number, status: string) {
    const data = { transaction: { id: "txn-1", amount_in_cents: amountInCents, status } };
    const properties = ["transaction.id", "transaction.amount_in_cents", "transaction.status"];
    const concatenado = properties.map((ruta) => valorPorRuta(data, ruta)).join("");
    const checksum = createHash("sha256")
      .update(`${concatenado}${TIMESTAMP}${SECRETO_EVENTOS}`)
      .digest("hex")
      .toUpperCase();
    return {
      cuerpo: { signature: { checksum, properties }, timestamp: TIMESTAMP, data },
      checksum,
    };
  }

  it("acepta un evento firmado correctamente", () => {
    const { cuerpo } = evento(11_200_00, "APPROVED");
    expect(eventoWompiEsAutentico(cuerpo, SECRETO_EVENTOS)).toBe(true);
  });

  it("rechaza una firma alterada", () => {
    const { cuerpo } = evento(11_200_00, "APPROVED");
    const alterado = {
      ...cuerpo,
      signature: { ...cuerpo.signature, checksum: "0".repeat(64) },
    };
    expect(eventoWompiEsAutentico(alterado, SECRETO_EVENTOS)).toBe(false);
  });

  it("rechaza un evento sin signature", () => {
    const { cuerpo } = evento(11_200_00, "APPROVED");
    const sinFirma = { timestamp: cuerpo.timestamp, data: cuerpo.data };
    expect(eventoWompiEsAutentico(sinFirma, SECRETO_EVENTOS)).toBe(false);
  });
});

describe("recibo firmado de la página de gracias", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET ??= "secreto-de-prueba-para-firmar-recibos";
  });

  it("devuelve el total cuando la firma corresponde", () => {
    const firma = firmarRecibo("ORD-001024", 175_000);
    expect(leerReciboFirmado("ORD-001024", "175000", firma)).toBe(175_000);
  });

  it("rechaza un total alterado en la barra de direcciones", () => {
    const firma = firmarRecibo("ORD-001024", 175_000);
    expect(leerReciboFirmado("ORD-001024", "1", firma)).toBeNull();
    expect(leerReciboFirmado("ORD-001024", "999999", firma)).toBeNull();
  });

  it("rechaza reusar la firma de otro pedido", () => {
    const firma = firmarRecibo("ORD-000001", 175_000);
    expect(leerReciboFirmado("ORD-999999", "175000", firma)).toBeNull();
  });

  it("rechaza firmas ausentes o basura, y totales no enteros", () => {
    expect(leerReciboFirmado("ORD-1", "175000", null)).toBeNull();
    expect(leerReciboFirmado("ORD-1", "175000", "inventada")).toBeNull();
    expect(leerReciboFirmado(null, "175000", "x")).toBeNull();
    const firma = firmarRecibo("ORD-1", 100);
    expect(leerReciboFirmado("ORD-1", "100.5", firma)).toBeNull();
    expect(leerReciboFirmado("ORD-1", "-100", firma)).toBeNull();
  });
});
