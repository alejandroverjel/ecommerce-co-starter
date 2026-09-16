/**
 * Etiqueta de estado.
 *
 * Los colores se resuelven a 4 tonos semánticos sobre los tokens del sitio
 * (éxito, aviso, peligro, neutro), nunca a clases de color fijas de
 * Tailwind: así se ven bien con cualquier paleta y en modo oscuro.
 */

const TONOS: Record<string, string> = {
  // Éxito
  pagado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  en_preparacion: "bg-[var(--exito)]/15 text-[var(--exito)]",
  enviado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  entregado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  aprobado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  activo: "bg-[var(--exito)]/15 text-[var(--exito)]",
  // Aviso
  pendiente: "bg-[var(--aviso)]/15 text-[var(--aviso)]",
  staff: "bg-[var(--aviso)]/15 text-[var(--aviso)]",
  // Peligro. "rechazado" y "agotado" son justo lo que hay que notar entre
  // los cobros de un pedido y el catálogo.
  rechazado: "bg-[var(--peligro-fondo)] text-[var(--peligro)]",
  agotado: "bg-[var(--peligro-fondo)] text-[var(--peligro)]",
  admin: "bg-[var(--peligro-fondo)] text-[var(--peligro)]",
  // Neutro
  cancelado: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]",
  reembolsado: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]",
  borrador: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]",
  archivado: "bg-[var(--fondo-hondo)] text-[var(--texto-tenue)]",
  cliente: "bg-[var(--fondo-hondo)] text-[var(--texto-suave)]",
};

/** Los valores crudos del enum no se muestran nunca. */
export const TEXTOS: Record<string, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
  en_preparacion: "En preparación",
  enviado: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  activo: "Activo",
  borrador: "Borrador",
  archivado: "Archivado",
  agotado: "Agotado",
  admin: "Administrador",
  staff: "Equipo",
  cliente: "Cliente",
};

export function EtiquetaEstado({ estado }: { estado: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
        TONOS[estado] ?? TONOS.borrador
      }`}
    >
      {TEXTOS[estado] ?? estado}
    </span>
  );
}
