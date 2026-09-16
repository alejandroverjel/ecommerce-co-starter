"use client";

import { usePathname } from "next/navigation";

import { enlaceWhatsapp } from "@/lib/sitio";

/**
 * Botón flotante de WhatsApp. Se oculta si la tienda no tiene WhatsApp
 * configurado, y en el carrito y el pago: ahí el objetivo es terminar la
 * compra, no abrir otra conversación.
 */
export function BotonWhatsapp() {
  const ruta = usePathname() ?? "";

  const enFlujoDeCompra =
    ruta.startsWith("/carrito") || ruta.startsWith("/finalizar-compra");

  if (enFlujoDeCompra) return null;

  const href = enlaceWhatsapp();
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Abajo a la derecha: el contenido de la página se alinea a la
      // izquierda, así que ahí el botón tapaba los titulares de sección.
      className="group fixed bottom-5 right-5 z-30 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-[#0b2e18] shadow-lg transition-transform hover:scale-105 motion-reduce:hover:scale-100"
    >
      {/* Tooltip: aparece al pasar el cursor o enfocar con teclado. */}
      <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        Escríbenos por WhatsApp
      </span>

      {/* Glifo oficial de WhatsApp. */}
      <svg viewBox="0 0 24 24" className="relative z-10 size-7 shrink-0" fill="currentColor" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a12 12 0 0 0 5.71 1.447h.006c6.585 0 11.946-5.335 11.949-11.893a11.8 11.8 0 0 0-3.48-8.413" />
      </svg>
      <span className="solo-lectores">Escríbenos por WhatsApp</span>
    </a>
  );
}
