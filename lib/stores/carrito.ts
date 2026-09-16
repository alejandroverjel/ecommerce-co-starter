"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { TIENDA } from "@/tienda.config";

/**
 * Carrito del cliente.
 *
 * Vive en el navegador (localStorage). El servidor NUNCA confía en estos
 * precios: al finalizar la compra, `create_pending_order` vuelve a leer cada
 * precio de la base de datos. Lo que se guarda aquí es solo qué quiere
 * comprar la persona, no cuánto cuesta.
 */

export type LineaCarrito = {
  productoId: string;
  varianteId: string | null;
  slug: string;
  nombre: string;
  /** Precio al momento de agregar. Solo para mostrar; el servidor lo recalcula. */
  precioCop: number;
  imagenUrl: string | null;
  ruta: string;
  cantidad: number;
};

type EstadoCarrito = {
  lineas: LineaCarrito[];
  /** Panel lateral abierto. Es estado de interfaz, no se persiste (ver partialize). */
  abierto: boolean;
  agregar: (linea: Omit<LineaCarrito, "cantidad">, cantidad?: number) => void;
  quitar: (productoId: string, varianteId: string | null) => void;
  cambiarCantidad: (
    productoId: string,
    varianteId: string | null,
    cantidad: number,
  ) => void;
  vaciar: () => void;
  abrirPanel: () => void;
  cerrarPanel: () => void;
};

const mismaLinea = (a: LineaCarrito, productoId: string, varianteId: string | null) =>
  a.productoId === productoId && a.varianteId === varianteId;

/**
 * Tope de unidades por línea. Es el mismo límite que exige el servidor
 * (esquemaPeticionPedido: cantidad.max(TIENDA.checkout.maxUnidadesPorProducto)).
 * Tenerlo aquí evita que el carrito arme un pedido que el checkout va a
 * rechazar con 400.
 */
export const TOPE_UNIDADES = TIENDA.checkout.maxUnidadesPorProducto;

export const useCarrito = create<EstadoCarrito>()(
  persist(
    (set) => ({
      lineas: [],
      abierto: false,

      // Al agregar se abre el panel: confirma la acción sin sacar a la persona
      // de la página donde estaba.
      agregar: (linea, cantidad = 1) =>
        set((estado) => {
          const existente = estado.lineas.find((l) =>
            mismaLinea(l, linea.productoId, linea.varianteId),
          );

          if (existente) {
            return {
              abierto: true,
              lineas: estado.lineas.map((l) =>
                mismaLinea(l, linea.productoId, linea.varianteId)
                  ? {
                      // `...linea` refresca precio, nombre e imagen con los
                      // datos frescos: si el precio cambió desde que se agregó,
                      // el carrito muestra el actual y no uno viejo de hace días.
                      ...l,
                      ...linea,
                      cantidad: Math.min(l.cantidad + cantidad, TOPE_UNIDADES),
                    }
                  : l,
              ),
            };
          }

          return { abierto: true, lineas: [...estado.lineas, { ...linea, cantidad }] };
        }),

      quitar: (productoId, varianteId) =>
        set((estado) => ({
          lineas: estado.lineas.filter((l) => !mismaLinea(l, productoId, varianteId)),
        })),

      cambiarCantidad: (productoId, varianteId, cantidad) =>
        set((estado) => ({
          // Cantidad 0 o menos equivale a quitar la línea.
          lineas:
            cantidad <= 0
              ? estado.lineas.filter((l) => !mismaLinea(l, productoId, varianteId))
              : estado.lineas.map((l) =>
                  mismaLinea(l, productoId, varianteId)
                    ? { ...l, cantidad: Math.min(cantidad, TOPE_UNIDADES) }
                    : l,
                ),
        })),

      vaciar: () => set({ lineas: [] }),
      abrirPanel: () => set({ abierto: true }),
      cerrarPanel: () => set({ abierto: false }),
    }),
    {
      name: `${TIENDA.slug}-carrito`,
      version: 1,
      // Solo se guardan las líneas. `abierto` es estado de interfaz: persistirlo
      // haría que el panel apareciera abierto al recargar.
      partialize: (estado) => ({ lineas: estado.lineas }),
    },
  ),
);

/** Cuántas unidades hay en total. Para el contador de la cabecera. */
export const contarUnidades = (lineas: LineaCarrito[]) =>
  lineas.reduce((n, l) => n + l.cantidad, 0);

/** Subtotal en pesos. Solo para mostrar: el servidor recalcula al pagar. */
export const calcularSubtotal = (lineas: LineaCarrito[]) =>
  lineas.reduce((n, l) => n + l.precioCop * l.cantidad, 0);
