"use client";

import { useState } from "react";
import { Check, Copy, Printer } from "lucide-react";

/**
 * El mensaje de regalo del pedido.
 *
 * Es lo que hace la persona que arma el pedido: leer el mensaje y pasarlo al
 * empaque. Por eso el mensaje se muestra grande y sin recortar, y hay dos
 * formas de sacarlo de la pantalla:
 *
 *  - Copiar, para pegarlo en la impresora de etiquetas o en WhatsApp.
 *  - Imprimir, que saca SOLO el mensaje en una hoja.
 *
 * La impresión se hace añadiendo una clase al `body` en vez de con reglas
 * `print:` sueltas. La ruta del día ya se imprime entera —es su función— y una
 * regla global de "oculta todo menos el mensaje" rompería esa otra impresión.
 * Con la clase, el aislamiento solo existe mientras dura este `window.print()`.
 */

const CSS_IMPRESION = `
@media print {
  body.imprimiendo-tarjeta * { visibility: hidden; }
  body.imprimiendo-tarjeta #tarjeta-imprimible,
  body.imprimiendo-tarjeta #tarjeta-imprimible * { visibility: visible; }
  body.imprimiendo-tarjeta #tarjeta-imprimible {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    border: 0;
    box-shadow: none;
    padding: 0;
  }
  body.imprimiendo-tarjeta .no-imprimir { display: none; }
}
`;

export function TarjetaPedido({
  numero,
  destinatario,
  mensaje,
}: {
  numero: string;
  destinatario: string | null;
  mensaje: string | null;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    if (!mensaje) return;

    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS en local): seleccionar el
      // texto a mano sigue funcionando, así que no se interrumpe a nadie.
    }
  }

  function imprimir() {
    const cuerpo = document.body;
    cuerpo.classList.add("imprimiendo-tarjeta");

    // `onafterprint` no dispara en todos los navegadores si el diálogo se
    // cancela rápido; el temporizador es la red que evita dejar la página
    // marcada e imprimible a medias.
    const limpiar = () => cuerpo.classList.remove("imprimiendo-tarjeta");
    window.addEventListener("afterprint", limpiar, { once: true });
    window.print();
    setTimeout(limpiar, 1000);
  }

  return (
    <section className="tarjeta p-6">
      <style>{CSS_IMPRESION}</style>

      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--texto-tenue)]">
          Mensaje de regalo
        </h2>

        {mensaje && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copiar}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--fondo-hondo)]"
            >
              {copiado ? (
                <>
                  <Check className="size-3.5" aria-hidden />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden />
                  Copiar
                </>
              )}
            </button>

            <button
              type="button"
              onClick={imprimir}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--fondo-hondo)]"
            >
              <Printer className="size-3.5" aria-hidden />
              Imprimir
            </button>
          </div>
        )}
      </div>

      {mensaje ? (
        <div id="tarjeta-imprimible" className="mt-4">
          <p className="display text-2xl leading-relaxed">{mensaje}</p>
          <p className="mt-6 text-xs text-[var(--texto-tenue)]">
            {numero}
            {destinatario ? ` · Para ${destinatario}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--texto-tenue)]">
          Este pedido no lleva mensaje.
        </p>
      )}
    </section>
  );
}

/**
 * Solo copiar, sin imprimir.
 *
 * Para la ruta del día, donde la tarjeta ya se imprime junto con el resto de
 * la hoja y meter otro botón de imprimir confundiría más de lo que ayuda.
 */
export function BotonCopiarMensaje({ mensaje }: { mensaje: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(mensaje);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          /* sin portapapeles: el texto está a la vista igual */
        }
      }}
      className="print:hidden inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--fondo-elevado)]"
    >
      {copiado ? (
        <>
          <Check className="size-3.5" aria-hidden />
          Copiado
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden />
          Copiar mensaje
        </>
      )}
    </button>
  );
}
