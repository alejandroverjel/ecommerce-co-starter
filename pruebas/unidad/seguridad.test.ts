import { describe, expect, it } from "vitest";

import { limpiarHtml } from "@/lib/admin/sanitizar";
import { CORTE_FRANJA, FRANJAS, franjaSigueAbierta, hoyEnBogota } from "@/lib/validaciones/pedido";

/**
 * El sanitizador protege a los CLIENTES y al administrador de una cuenta de
 * equipo comprometida: lo que se guarda aquí se ejecuta en el navegador de
 * quien abra la ficha. La versión anterior era una red de expresiones
 * regulares y estos payloads la atravesaban enteros.
 */
describe("limpiarHtml", () => {
  const peligroso = /onerror|onload|<script|javascript:|<svg|<iframe/i;

  const evasiones = [
    ["separador con barra en vez de espacio", '<img/onerror=alert(1) src=x>'],
    ["etiqueta svg con onload", '<svg/onload=alert(document.domain)>'],
    ["javascript: con entidad decimal", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["javascript: con entidad nombrada", '<a href="javascript&colon;alert(1)">x</a>'],
    ["script directo", "<script>alert(1)</script>"],
    ["iframe", '<iframe src="https://malo.example.com"></iframe>'],
    ["manejador en mayúsculas", '<img SRC=x ONERROR=alert(1)>'],
    ["data: URI ejecutable", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'],
  ] as const;

  it.each(evasiones)("neutraliza: %s", (_nombre, entrada) => {
    expect(limpiarHtml(entrada).html).not.toMatch(peligroso);
  });

  it("conserva el formato legítimo que escribe el equipo", () => {
    const bueno = "<p>Texto <strong>en negrita</strong> y una <em>cursiva</em>.</p><ul><li>Uno</li></ul>";
    expect(limpiarHtml(bueno).html).toContain("<strong>");
    expect(limpiarHtml(bueno).html).toContain("<li>");
  });

  it("mantiene los enlaces http(s) pero les pone rel de seguridad", () => {
    const { html } = limpiarHtml('<a href="https://example.com">ver</a>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("noopener");
  });

  it("quita el color fijo que rompía el modo oscuro", () => {
    // Herencia de constructores visuales del CMS de origen.
    const { html } = limpiarHtml('<span style="color:#000">gris</span>');
    expect(html).not.toContain("style");
    expect(html).toContain("gris");
  });

  it("avisa cuando tuvo que quitar algo", () => {
    expect(limpiarHtml("<script>x</script>").cambiado).toBe(true);
    expect(limpiarHtml("<p>limpio</p>").cambiado).toBe(false);
  });
});

/**
 * A las 21:30 se aceptaba una entrega para HOY "de 8:00 a 12:00": el pedido
 * entraba en la pantalla de entregas del día ya vencido.
 */
describe("franjas de entrega del mismo día", () => {
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it("cualquier franja vale para otro día", () => {
    for (const valor of FRANJAS.map((f) => f.valor)) {
      expect(franjaSigueAbierta(valor, manana)).toBe(true);
    }
  });

  it("para hoy, depende de la hora y las franjas cierran en orden", () => {
    const hoy = hoyEnBogota();
    // Mismo orden que CORTE_FRANJA: de la que cierra más temprano a la que
    // cierra más tarde.
    const valores = Object.keys(CORTE_FRANJA).sort(
      (a, b) => CORTE_FRANJA[a] - CORTE_FRANJA[b],
    );
    const abiertas = valores.map((f) => franjaSigueAbierta(f, hoy));

    // Nunca puede estar abierta una franja anterior si la siguiente ya cerró:
    // el corte va de menor a mayor.
    for (let i = 1; i < abiertas.length; i++) {
      if (abiertas[i - 1]) expect(abiertas[i]).toBe(true);
    }
  });

  it("una franja que esta tienda no ofrece bloquea el pedido", () => {
    // franjaSigueAbierta solo conoce las franjas de CORTE_FRANJA (las que
    // configura tienda.config.ts); cualquier otra cuenta como cerrada.
    expect(franjaSigueAbierta("inventada", hoyEnBogota())).toBe(false);
  });
});
