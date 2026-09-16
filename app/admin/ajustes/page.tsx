import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { auth, rolReal } from "@/auth";
import {
  FormularioAjustes,
  FormularioPasarela,
  type AjustesTienda,
  type PasarelaAdmin,
  type PistaSecreto,
} from "@/components/admin/formulario-ajustes";
import { db } from "@/lib/db";
import { paymentGateways, storeSettings } from "@/lib/db/schema";
import { hayLlaveMaestra, type ConfigPasarela } from "@/lib/admin/secretos";
import { estaIntegrada, PASARELAS } from "@/lib/validaciones/ajustes";

export const metadata: Metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

/**
 * Ajustes de la tienda.
 *
 * SOLO ADMINISTRACIÓN. El layout de /admin deja entrar también al equipo,
 * porque son quienes arman los pedidos; el IVA, el envío y las llaves de cobro
 * no son cosa suya. La comprobación se repite en cada server action: esta de
 * aquí solo decide qué se pinta.
 */
export default async function AjustesAdmin() {
  const sesion = await auth();
  const rol = sesion?.user?.id ? await rolReal(sesion.user.id) : null;

  if (rol !== "admin") {
    return (
      <div className="bloque flex items-start gap-3 p-12 text-sm text-[var(--texto-suave)]">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[var(--texto-tenue)]" aria-hidden />
        <p>
          Los ajustes de la tienda y las llaves de cobro los administra solo la cuenta de
          administración. Si necesitas cambiar algo de aquí, pídeselo.
        </p>
      </div>
    );
  }

  const [ajustes, pasarelas] = await Promise.all([leerAjustes(), leerPasarelas()]);

  if (!ajustes) {
    return (
      <div className="bloque p-12 text-sm text-[var(--texto-suave)]">
        <p className="font-medium text-[var(--texto)]">store_settings está vacía.</p>
        <p className="mt-2">
          Sin esa fila el servidor calcularía envío $0 en cada pedido. Corre{" "}
          <code className="rounded bg-[var(--fondo-hondo)] px-1.5 py-0.5">pnpm db:seed</code> antes
          de seguir.
        </p>
      </div>
    );
  }

  const integradas = pasarelas.filter((p) => estaIntegrada(p.pasarela));
  const pendientes = pasarelas.filter((p) => !estaIntegrada(p.pasarela));
  const conLlaveMaestra = hayLlaveMaestra();

  return (
    <div>
      <h1 className="display text-3xl">Ajustes</h1>
      <p className="mt-1 text-[var(--texto-suave)]">
        Lo que se cambia aquí afecta a la tienda entera.
      </p>

      <div className="mt-6 grid gap-6">
        <FormularioAjustes ajustes={ajustes} />

        {integradas.map((p) => (
          <FormularioPasarela key={p.pasarela} pasarela={p} hayLlaveMaestra={conLlaveMaestra} />
        ))}

        {pendientes.length > 0 && (
          <div className="bloque p-6 sm:p-7">
            <h2 className="display text-xl">Otras pasarelas</h2>
            {/* Se listan pero no se pueden encender: el checkout solo sabe
                cobrar con las pasarelas integradas arriba, y ofrecer un
                método que nadie procesa deja pedidos pendientes para
                siempre. */}
            <p className="mt-1 text-sm text-[var(--texto-suave)]">
              Declaradas en la base pero sin integrar. Encenderlas no habilitaría nada.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {pendientes.map((p) => (
                <li key={p.pasarela} className="flex items-center justify-between gap-4">
                  <span>{p.nombre}</span>
                  <span className="text-xs text-[var(--texto-tenue)]">Sin integrar</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

async function leerAjustes(): Promise<AjustesTienda | null> {
  const filas = await db
    .select({
      envioPlanoCop: storeSettings.flatShippingCop,
      umbralEnvioGratisCop: storeSettings.freeShippingThresholdCop,
      ivaBps: storeSettings.taxRateBps,
      minutosReserva: storeSettings.reservationTtlMinutes,
    })
    .from(storeSettings)
    .limit(1);

  return filas[0] ?? null;
}

async function leerPasarelas(): Promise<PasarelaAdmin[]> {
  const filas = await db
    .select({
      pasarela: paymentGateways.gateway,
      nombre: paymentGateways.displayName,
      habilitada: paymentGateways.isEnabled,
      pruebas: paymentGateways.isSandbox,
      llavePublica: paymentGateways.publicKey,
      config: paymentGateways.config,
    })
    .from(paymentGateways)
    .orderBy(paymentGateways.position);

  const reales = new Set<string>(PASARELAS);

  return filas
    // 'manual' vive en el mismo enum para que los cobros en efectivo cuadren
    // en `payments`, pero no es una pasarela y no tiene llaves que configurar.
    .filter((f) => reales.has(f.pasarela))
    .map((f) => {
      const secretos = (f.config as ConfigPasarela | null)?.secretos;

      // Al cliente solo le va la pista. El sobre cifrado se queda aquí: no hay
      // motivo para que el texto cifrado viaje al navegador.
      const pista = (nombre: "llavePrivada" | "secretoEventos" | "secretoIntegridad"): PistaSecreto => {
        const guardado = secretos?.[nombre];
        return guardado
          ? { pista: guardado.pista, actualizado: guardado.actualizado }
          : null;
      };

      return {
        pasarela: f.pasarela,
        nombre: f.nombre,
        habilitada: f.habilitada,
        pruebas: f.pruebas,
        llavePublica: f.llavePublica ?? "",
        llavePrivada: pista("llavePrivada"),
        secretoEventos: pista("secretoEventos"),
        secretoIntegridad: pista("secretoIntegridad"),
      };
    });
}
