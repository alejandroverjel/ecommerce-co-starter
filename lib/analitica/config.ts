import { TIENDA } from "@/tienda.config";

/**
 * Configuración de analítica: GA4 directo + Google Tag Manager.
 *
 * GA4 (gtag) va directo con su Measurement ID: mide desde el primer día sin
 * depender de configurar nada más. GTM se carga además como contenedor para
 * sumar otras etiquetas —Meta Pixel, conversiones— desde su interfaz web sin
 * volver a desplegar.
 *
 * IMPORTANTE para no contar doble: GA4 ya está aquí, directo. Dentro de GTM se
 * configuran OTRAS etiquetas (Meta, etc.), NO GA4 otra vez.
 *
 * Ambos IDs son PÚBLICOS (aparecen en el HTML), así que van por variable de
 * entorno pública y no como secreto: NEXT_PUBLIC_GA_ID / NEXT_PUBLIC_GTM_ID.
 * SIN RESPALDO: vacíos = sin analítica y sin aviso de cookies (sin estas
 * etiquetas no hay cookies que consentir).
 */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";
export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? "";

/** ¿Hay algo que medir? Decide si aparece el aviso de cookies. */
export const HAY_ANALITICA = Boolean(GA_ID || GTM_ID);

/** Clave del consentimiento en localStorage, propia de cada tienda. */
export const CLAVE_CONSENTIMIENTO = `${TIENDA.slug}-consentimiento`;

export type Consentimiento = "todo" | "esencial";
