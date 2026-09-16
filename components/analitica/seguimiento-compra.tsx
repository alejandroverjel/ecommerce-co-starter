"use client";

import { useEffect } from "react";

import { trackearCompra } from "@/lib/analitica/eventos";

/**
 * Dispara el evento de compra en la página de gracias.
 *
 * Recibe el total YA verificado por el servidor (firma), no un número de la
 * URL. Se marca el pedido en sessionStorage para no contar la conversión dos
 * veces si el cliente recarga. Si no hay analítica o no aceptó cookies,
 * trackearCompra es un no-op.
 */
export function SeguimientoCompra({
  pedido,
  totalCop,
}: {
  pedido: string;
  totalCop: number;
}) {
  useEffect(() => {
    const clave = `compra-medida-${pedido}`;
    try {
      if (sessionStorage.getItem(clave)) return;
      sessionStorage.setItem(clave, "1");
    } catch {
      // Sin sessionStorage: se mide igual, asumiendo que no hubo recarga.
    }
    trackearCompra(pedido, totalCop);
  }, [pedido, totalCop]);

  return null;
}
