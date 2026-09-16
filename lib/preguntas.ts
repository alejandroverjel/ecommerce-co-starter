/**
 * Preguntas frecuentes de la tienda. FUENTE ÚNICA.
 *
 * Las lee la página de contacto (para pintarlas) y el FAQPage de datos
 * estructurados (para que Google y los motores de respuesta —ChatGPT,
 * Perplexity, AI Overviews— citen la respuesta oficial en vez de inventarla).
 * Si viven en dos sitios, divergen.
 *
 * El texto de cada pregunta lo escribe cada tienda en `TIENDA.preguntas`. La
 * única excepción es la clave "envio": su respuesta se arma aquí con las
 * cifras vivas de `store_settings`, para no obligar a editar código cada vez
 * que cambia una tarifa.
 */
import { formatearCOP } from "@/lib/formato";
import { TIENDA } from "@/tienda.config";

/**
 * Las respuestas que dependen de la configuración de la tienda reciben los
 * números de verdad; no se escriben a mano en dos sitios.
 *
 * "Gratis a partir de cierto monto… el valor exacto aparece en el carrito"
 * obligaría a llegar al checkout para saber cuánto cuesta el envío. Un
 * asistente que responde "¿cuánto cuesta el envío?" no completa un checkout,
 * así que sin la cifra escrita no hay nada que citar — y el dato existe desde
 * el principio en `store_settings`. Si la tienda no declaró preguntas, no hay
 * nada que devolver.
 */
export function preguntasFrecuentes(envio: {
  envioPlanoCop: number;
  umbralEnvioGratisCop: number;
}): readonly { p: string; r: string }[] {
  return TIENDA.preguntas.map((f) =>
    f.clave === "envio"
      ? {
          p: f.p,
          r:
            `El envío cuesta ${formatearCOP(envio.envioPlanoCop)} con tarifa plana en ${TIENDA.cobertura.descripcion}, ` +
            `y es gratis en compras desde ${formatearCOP(envio.umbralEnvioGratisCop)}.`,
        }
      : { p: f.p, r: f.r },
  );
}
