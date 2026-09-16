"use client";

import { useState } from "react";
import { Check, ClipboardList, MessageCircle } from "lucide-react";

/**
 * Contacto y logística del pedido, para el día a día del panel.
 *
 * La operación real de esta tienda pasa por WhatsApp: se coordina la entrega
 * con el comprador y se le pasan los datos al domiciliario. Hasta ahora el
 * panel solo ofrecía `tel:` y `mailto:`, y el número había que copiarlo a
 * mano para escribir por WhatsApp — la acción más repetida del día.
 */

/**
 * Número colombiano → enlace wa.me.
 *
 * Acepta lo que haya escrito el cliente ("300 000 0000", "+57 3000000000",
 * "573000000000") y lo deja en el formato que wa.me exige: solo dígitos con
 * indicativo. Si el número no parece un celular colombiano se devuelve null
 * y el botón no se pinta: un enlace roto es peor que ninguno.
 */
export function enlaceWhatsAppPedido(
  telefono: string,
  mensaje: string,
): string | null {
  const digitos = telefono.replace(/\D/g, "");

  const completo =
    digitos.length === 10 && digitos.startsWith("3")
      ? `57${digitos}`
      : digitos.length === 12 && digitos.startsWith("573")
        ? digitos
        : null;

  if (!completo) return null;

  return `https://wa.me/${completo}?text=${encodeURIComponent(mensaje)}`;
}

export function BotonWhatsApp({
  telefono,
  mensaje,
  etiqueta,
}: {
  telefono: string;
  mensaje: string;
  etiqueta: string;
}) {
  const enlace = enlaceWhatsAppPedido(telefono, mensaje);
  if (!enlace) return null;

  return (
    <a
      href={enlace}
      target="_blank"
      rel="noopener noreferrer"
      className="print:hidden inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-[var(--texto-suave)] transition-colors hover:bg-[var(--fondo-hondo)]"
    >
      <MessageCircle className="size-3.5" aria-hidden />
      {etiqueta}
    </a>
  );
}

export type DatosEntrega = {
  numero: string;
  destinatario: string | null;
  telefono: string | null;
  direccion: string | null;
  ciudad: string | null;
  fecha: string | null;
  franja: string | null;
  indicaciones: string | null;
  totalCop: string;
  cobrar: boolean;
};

/**
 * Copia los datos de entrega en un solo texto listo para pegarle al
 * domiciliario por WhatsApp. Transcribir una dirección a mano es el error
 * que arruina la entrega; este botón lo elimina.
 */
export function BotonCopiarEntrega({ datos }: { datos: DatosEntrega }) {
  const [copiado, setCopiado] = useState(false);

  const texto = [
    `Pedido ${datos.numero}`,
    datos.destinatario && `Entregar a: ${datos.destinatario}`,
    datos.telefono && `Teléfono: ${datos.telefono}`,
    datos.direccion && `Dirección: ${datos.direccion}`,
    datos.ciudad && `Ciudad: ${datos.ciudad}`,
    datos.fecha && `Fecha: ${datos.fecha}${datos.franja ? ` · ${datos.franja}` : ""}`,
    datos.indicaciones && `Indicaciones: ${datos.indicaciones}`,
    datos.cobrar && `COBRAR AL ENTREGAR: ${datos.totalCop}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          /* sin portapapeles: los datos están a la vista igual */
        }
      }}
      className="print:hidden inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-[var(--texto-suave)] transition-colors hover:bg-[var(--fondo-hondo)]"
    >
      {copiado ? (
        <>
          <Check className="size-3.5" aria-hidden />
          Copiado
        </>
      ) : (
        <>
          <ClipboardList className="size-3.5" aria-hidden />
          Copiar datos de entrega
        </>
      )}
    </button>
  );
}
