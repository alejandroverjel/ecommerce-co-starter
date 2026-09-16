"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Megaphone, Package, Receipt, Settings, Ticket, Truck, Users } from "lucide-react";

/**
 * Navegación del panel.
 *
 * "Entregas" va primero, no el resumen: es la pantalla que alguien abre cada
 * mañana para saber qué armar y a quién llamar. El starter no la tenía.
 *
 * "Ajustes" va última porque es la que menos se abre y la que más rompe: el
 * IVA y el envío de esa pantalla los usa el servidor para cobrar.
 */
const SECCIONES = [
  { href: "/admin/entregas/", texto: "Entregas", icono: Truck },
  { href: "/admin/", texto: "Resumen", icono: LayoutGrid, exacta: true },
  { href: "/admin/pedidos/", texto: "Pedidos", icono: Receipt },
  { href: "/admin/productos/", texto: "Productos", icono: Package },
  // Campañas (portada), cupones (dinero), clientes (PII) y ajustes (llaves de
  // cobro) son solo de administración: se ocultan al equipo para no ofrecer un
  // enlace que solo lleva a un rechazo.
  { href: "/admin/campanas/", texto: "Campañas", icono: Megaphone, soloAdmin: true },
  { href: "/admin/cupones/", texto: "Cupones", icono: Ticket, soloAdmin: true },
  { href: "/admin/clientes/", texto: "Clientes", icono: Users, soloAdmin: true },
  { href: "/admin/ajustes/", texto: "Ajustes", icono: Settings, soloAdmin: true },
];

export function NavAdmin({ esAdmin = false }: { esAdmin?: boolean }) {
  const ruta = usePathname() ?? "";
  const secciones = SECCIONES.filter((s) => esAdmin || !s.soloAdmin);

  return (
    <nav className="mt-6 -mx-1 overflow-x-auto">
      <ul className="flex gap-1 px-1">
        {secciones.map((s) => {
          const activa = s.exacta
            ? ruta === s.href || ruta === s.href.replace(/\/$/, "")
            : ruta.startsWith(s.href);

          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={activa ? "page" : undefined}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                  activa
                    ? "bg-[var(--acento)] text-[var(--acento-texto)]"
                    : "text-[var(--texto-suave)] hover:bg-[var(--fondo-elevado)]"
                }`}
              >
                <s.icono className="size-4" aria-hidden />
                {s.texto}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
