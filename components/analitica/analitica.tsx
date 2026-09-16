"use client";

import { useSyncExternalStore } from "react";
import Script from "next/script";

import {
  CLAVE_CONSENTIMIENTO,
  GA_ID,
  GTM_ID,
  HAY_ANALITICA,
  type Consentimiento,
} from "@/lib/analitica/config";
import { useMontado } from "@/lib/hooks/usar-montado";

/**
 * Analítica con Google Tag Manager y consentimiento opt-in.
 *
 * En Colombia la Ley 1581 (habeas data) pide consentimiento antes de instalar
 * cookies de seguimiento, así que GTM —y con él GA4, Meta Pixel y lo que se
 * configure dentro— NO se carga hasta que el visitante acepta. Sin decisión se
 * muestra un aviso discreto; "Solo lo esencial" recuerda la negativa.
 *
 * GA4 y las demás etiquetas se conectan DENTRO de GTM (interfaz web), no aquí:
 * el código solo carga el contenedor. Así el negocio suma o quita medición sin
 * volver a desplegar.
 *
 * El contenedor se carga con next/script (afterInteractive): no bloquea el
 * primer render. Si no hay ID, este componente no pinta nada.
 */
/**
 * El consentimiento vive en localStorage, que es un store EXTERNO a React.
 *
 * Se lee con `useSyncExternalStore` y no con useState+useEffect por la misma
 * razón que documenta `useMontado`: llamar a setState dentro de un efecto
 * provoca renders en cascada y la regla `react-hooks/set-state-in-effect` lo
 * marca como error. Aquí además hace falta avisar a los componentes cuando la
 * persona decide, así que la suscripción sí lleva oyentes de verdad.
 */
const oyentes = new Set<() => void>();

function suscribir(alCambiar: () => void): () => void {
  oyentes.add(alCambiar);
  return () => {
    oyentes.delete(alCambiar);
  };
}

function leerEnCliente(): Consentimiento | null {
  try {
    const bruto = localStorage.getItem(CLAVE_CONSENTIMIENTO);
    return bruto === "todo" || bruto === "esencial" ? bruto : null;
  } catch {
    // Modo privado o cookies bloqueadas: se trata como sin decisión.
    return null;
  }
}

/** En el servidor nunca hay decisión: el aviso solo aparece tras hidratar. */
const leerEnServidor = (): Consentimiento | null => null;

function guardarDecision(valor: Consentimiento): void {
  try {
    localStorage.setItem(CLAVE_CONSENTIMIENTO, valor);
  } catch {
    /* sin localStorage: al menos vale para esta sesión */
  }
  for (const avisar of oyentes) avisar();
}

export function Analitica() {
  const montado = useMontado();
  const decision = useSyncExternalStore(suscribir, leerEnCliente, leerEnServidor);

  if (!HAY_ANALITICA) return null;

  const cargar = montado && decision === "todo";

  return (
    <>
      {cargar && GA_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}

      {cargar && GTM_ID && (
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      )}

      {/* Aviso de cookies: solo si hay analítica y no hay decisión previa. */}
      {montado && decision === null && (
        <div
          role="dialog"
          aria-label="Aviso de cookies"
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-4 shadow-[var(--sombra-levanta)] sm:inset-x-6 sm:bottom-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-[var(--texto-suave)]">
              Usamos cookies para entender cómo se usa la tienda y mejorarla. Puedes aceptarlas o
              seguir solo con las esenciales.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => guardarDecision("esencial")}
                className="rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--fondo-hondo)]"
              >
                Solo lo esencial
              </button>
              <button
                type="button"
                onClick={() => guardarDecision("todo")}
                className="rounded-full bg-[var(--acento)] px-4 py-2 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)]"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
