import type { Metadata } from "next";

import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { SelectorRol } from "@/components/admin/selector-rol";
import { listarClientes } from "@/lib/data/admin";
import { exigirAdminPagina } from "@/lib/admin/pagina";
import { formatearCOP, formatearFecha } from "@/lib/formato";

export const metadata: Metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

export default async function ClientesAdmin() {
  // SOLO administración. El listado trae correo, gasto e historial de cada
  // cuenta: es PII que el equipo de preparación de pedidos no necesita. La
  // guardia va ANTES de leer, para no materializar los datos de 200 personas
  // y recién entonces decidir el acceso.
  const actor = await exigirAdminPagina();
  const clientes = await listarClientes();
  const esAdmin = true;

  /**
   * Solo para el aviso de la interfaz: `listarClientes` trae las 200 cuentas
   * más recientes, así que este conteo puede quedarse corto en una tienda con
   * más. La regla de verdad —no dejar la tienda sin administradores— se
   * comprueba en la acción, dentro de la transacción y con las filas
   * bloqueadas.
   */
  const administradores = clientes.filter((c) => c.rol === "admin").length;

  return (
    <div>
      <h1 className="display text-3xl">Clientes</h1>
      <p className="mt-1 text-[var(--texto-suave)]">
        {clientes.length} {clientes.length === 1 ? "cuenta" : "cuentas"} registradas
        {esAdmin && administradores > 0 && (
          <>
            {" · "}
            {administradores} con administración
          </>
        )}
      </p>

      {clientes.length === 0 ? (
        <p className="mt-6 rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)] p-12 text-center text-sm text-[var(--texto-suave)]">
          Todavía nadie ha creado una cuenta. Los pedidos de invitado no aparecen aquí.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-elevado)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-widest text-[var(--texto-tenue)]">
                <th className="px-5 py-3 font-semibold">Persona</th>
                <th className="px-5 py-3 font-semibold">Rol</th>
                <th className="px-5 py-3 font-semibold">Registro</th>
                <th className="px-5 py-3 text-right font-semibold">Pedidos</th>
                <th className="px-5 py-3 text-right font-semibold">Ha gastado</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-5 py-3">
                    {c.nombre ?? "—"}
                    <span className="block text-xs text-[var(--texto-tenue)]">
                      {c.correo}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {esAdmin ? (
                      <SelectorRol
                        usuarioId={c.id}
                        rol={c.rol}
                        esYo={c.id === actor.id}
                        esUltimoAdmin={c.rol === "admin" && administradores <= 1}
                      />
                    ) : (
                      <EtiquetaEstado estado={c.rol} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-[var(--texto-suave)]">
                    {formatearFecha(c.registrado)}
                  </td>
                  <td className="precio px-5 py-3 text-right">{c.pedidos}</td>
                  <td className="cifra whitespace-nowrap px-5 py-3 text-right">
                    {formatearCOP(c.gastadoCop)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
