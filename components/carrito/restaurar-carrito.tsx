"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useCarrito, type LineaCarrito } from "@/lib/stores/carrito";

/**
 * Rellena el carrito con lo que traía la persona y la manda al checkout.
 *
 * Corre en el cliente porque el carrito vive en localStorage. Se REEMPLAZA el
 * contenido en vez de sumarlo: si abre el enlace dos veces, no debe terminar
 * con todo duplicado.
 */
export function RestaurarCarrito({ lineas }: { lineas: LineaCarrito[] }) {
  const router = useRouter();
  const hecho = useRef(false);

  useEffect(() => {
    // StrictMode monta dos veces en desarrollo; sin esta guarda navegaría dos
    // veces y se vería un parpadeo.
    if (hecho.current) return;
    hecho.current = true;

    useCarrito.setState({ lineas, abierto: false });
    router.replace("/finalizar-compra/");
  }, [lineas, router]);

  return (
    <p className="text-[var(--texto-suave)]">Recuperando tu carrito…</p>
  );
}
