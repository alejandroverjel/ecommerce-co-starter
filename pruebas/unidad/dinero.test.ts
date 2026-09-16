import { describe, expect, it } from "vitest";

import { aPuntosBasicos, aPorcentaje, leerImporte } from "@/lib/dinero";
import { calcularEnvio, faltaParaEnvioGratis } from "@/lib/envio";
import { formatearCOP } from "@/lib/formato";

/**
 * El dinero de esta tienda son ENTEROS DE PESOS y los porcentajes van en
 * PUNTOS BÁSICOS. Un float colado en cualquiera de los dos sitios se paga en
 * caja, así que estas reglas se prueban de verdad y no por inspección.
 */

describe("leerImporte — lo que escribe una persona", () => {
  it("acepta la notación colombiana con puntos de miles", () => {
    expect(leerImporte("60.000")).toMatchObject({ ok: true, pesos: 60_000 });
    expect(leerImporte("1.450.000")).toMatchObject({ ok: true, pesos: 1_450_000 });
    expect(leerImporte("$ 60.000")).toMatchObject({ ok: true, pesos: 60_000 });
    expect(leerImporte("60000")).toMatchObject({ ok: true, pesos: 60_000 });
  });

  it("rechaza decimales: el peso colombiano no los tiene", () => {
    expect(leerImporte("60.5").ok).toBe(false);
    expect(leerImporte("60,50").ok).toBe(false);
  });

  it("rechaza negativos y basura", () => {
    expect(leerImporte("-1000").ok).toBe(false);
    expect(leerImporte("").ok).toBe(false);
    expect(leerImporte("gratis").ok).toBe(false);
  });
});

describe("porcentajes en puntos básicos", () => {
  it("19% son 1900 puntos básicos, no 19 ni 0.19", () => {
    expect(aPuntosBasicos(19)).toBe(1900);
    expect(aPorcentaje(1900)).toBe(19);
  });

  it("ida y vuelta no pierde el valor", () => {
    for (const p of [0, 5, 10, 19, 100]) {
      expect(aPorcentaje(aPuntosBasicos(p))).toBe(p);
    }
  });
});

describe("envío", () => {
  const config = { envioPlanoCop: 15_000, umbralEnvioGratisCop: 250_000, ivaBps: 0, minutosReserva: 15 };

  it("cobra tarifa plana por debajo del umbral", () => {
    expect(calcularEnvio(100_000, config)).toBe(15_000);
  });

  it("EN el umbral exacto ya es gratis", () => {
    // El límite es el caso que siempre se implementa mal.
    expect(calcularEnvio(250_000, config)).toBe(0);
    expect(calcularEnvio(249_999, config)).toBe(15_000);
  });

  it("cuánto falta para el envío gratis; null cuando ya no falta nada", () => {
    expect(faltaParaEnvioGratis(100_000, config)).toBe(150_000);
    // null y no 0: así el componente sabe que no debe pintar el aviso.
    expect(faltaParaEnvioGratis(250_000, config)).toBeNull();
  });
});

describe("formatearCOP", () => {
  it("formatea en pesos, con punto de miles y sin decimales", () => {
    // Intl separa el símbolo con un espacio DURO (U+00A0), no uno normal: se
    // normaliza para que la prueba no dependa de ese detalle tipográfico.
    const cop = (n: number) => formatearCOP(n).replace(/\u00a0/g, " ");

    expect(cop(175_000)).toBe("$ 175.000");
    expect(cop(1_450_000)).toBe("$ 1.450.000");
    expect(cop(0)).toBe("$ 0");
    expect(cop(175_000)).not.toMatch(/[.,]\d{2}$/);
  });
});
