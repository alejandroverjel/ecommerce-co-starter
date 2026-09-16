"use client";

import { contarUnidades, useCarrito } from "@/lib/stores/carrito";
import { useMontado } from "@/lib/hooks/usar-montado";

/**
 * Burbuja con el número de unidades en el carrito.
 *
 * El carrito vive en localStorage, así que en el servidor siempre está vacío.
 * Renderizarlo antes de montar produce un desajuste de hidratación y un
 * parpadeo del número.
 */
export function ContadorCarrito() {
  const montado = useMontado();
  const lineas = useCarrito((e) => e.lineas);

  if (!montado) return null;

  const unidades = contarUnidades(lineas);
  if (unidades === 0) return null;

  return (
    <>
      {/* La burbuja visual es decorativa para lectores de pantalla; el
          número real se anuncia con este texto oculto, que además avisa
          los cambios sin robar el foco (aria-live). */}
      <span aria-live="polite" className="solo-lectores">
        {unidades === 1 ? "1 producto en el carrito" : `${unidades} productos en el carrito`}
      </span>
      <span
        aria-hidden
        className="cifra absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground leading-5"
      >
        {unidades > 99 ? "99+" : unidades}
      </span>
    </>
  );
}
