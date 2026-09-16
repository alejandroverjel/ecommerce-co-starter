"use client";

import { useSyncExternalStore } from "react";

/**
 * ¿Ya montó el componente en el navegador?
 *
 * PARA QUÉ: hay componentes que dependen de algo que solo existe en el cliente
 * —el carrito en localStorage, el tema resuelto—. Pintarlos en el servidor
 * produce un desajuste de hidratación y un parpadeo del contenido equivocado.
 *
 * POR QUÉ NO `useEffect(() => setMontado(true), [])`: es el patrón habitual,
 * pero llama a setState dentro de un efecto y provoca un render en cascada; la
 * regla `react-hooks/set-state-in-effect` lo marca como error, con razón.
 *
 * `useSyncExternalStore` resuelve exactamente esto sin estado ni efecto: React
 * usa el snapshot del servidor durante el render inicial y el del cliente en
 * cuanto hidrata. Una suscripción vacía basta, porque el valor no cambia nunca
 * después.
 */
const sinCambios = () => () => {};
const enCliente = () => true;
const enServidor = () => false;

export function useMontado(): boolean {
  return useSyncExternalStore(sinCambios, enCliente, enServidor);
}
