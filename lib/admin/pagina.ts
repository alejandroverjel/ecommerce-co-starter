import "server-only";

import { redirect } from "next/navigation";

import { auth, rolReal } from "@/auth";

/**
 * Guardia de PÁGINA del panel (distinta de la de las server actions).
 *
 * El layout de /admin ya comprueba la sesión, pero Next NO reejecuta un layout
 * compartido en la navegación cliente (soft-nav) entre páginas hermanas bajo
 * él, ni al pedir un segmento RSC suelto. Un staff degradado con el panel
 * abierto seguía navegando de una página a otra con su acceso intacto hasta
 * pulsar F5. Cada página se protege sola llamando a esto en su primera línea.
 *
 * Relee el rol de la BASE, no del token: el JWT dura siete días y no se puede
 * revocar, así que confiar en su claim de rol dejaría entrar a quien ya no
 * debe. Cuesta una consulta por carga; es barato al lado de una fuga de datos.
 */

export type ActorPanel = { id: string; rol: "admin" | "staff" };

async function guardia(minimo: "staff" | "admin"): Promise<ActorPanel> {
  const sesion = await auth();
  if (!sesion?.user?.id) redirect("/entrar/");

  const rol = await rolReal(sesion.user.id);
  if (rol !== "admin" && rol !== "staff") redirect("/");
  if (minimo === "admin" && rol !== "admin") redirect("/admin/");

  return { id: sesion.user.id, rol };
}

/** Deja pasar a administración y equipo. */
export const exigirPersonalPagina = () => guardia("staff");

/** Solo administración: ajustes, roles, datos de clientes. */
export const exigirAdminPagina = () => guardia("admin");
