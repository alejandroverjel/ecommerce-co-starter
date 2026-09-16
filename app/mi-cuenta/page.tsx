import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";

import { auth } from "@/auth";
import { salir } from "@/lib/auth/acciones";
import { ETIQUETAS_ESTADO, listarPedidosDeUsuario } from "@/lib/data/pedidos";
import { etiquetaFranja } from "@/lib/validaciones/pedido";
import { formatearCOP, formatearFecha, formatearFechaSola } from "@/lib/formato";
import { buttonVariants } from "@/components/ui/button";
import { enlaceWhatsapp } from "@/lib/sitio";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi cuenta",
  robots: { index: false, follow: false },
};

/** Colores por estado. El pedido cancelado no debe verse igual que el entregado. */
const TONO_ESTADO: Record<string, string> = {
  pendiente: "bg-muted text-muted-foreground",
  pagado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  en_preparacion: "bg-[var(--exito)]/15 text-[var(--exito)]",
  enviado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  entregado: "bg-[var(--exito)]/15 text-[var(--exito)]",
  cancelado: "bg-muted text-muted-foreground",
  reembolsado: "bg-muted text-muted-foreground",
};

export default async function MiCuenta() {
  const sesion = await auth();

  // La comprobación va aquí, en el servidor, no en un middleware: así el dato
  // nunca sale del servidor sin que se haya verificado quién lo pide.
  if (!sesion?.user?.id) redirect("/entrar/");

  const pedidos = await listarPedidosDeUsuario(sesion.user.id);
  const whatsapp = enlaceWhatsapp();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl md:text-4xl">Mi cuenta</h1>
          <p className="mt-1.5 text-muted-foreground">
            {sesion.user.name ?? sesion.user.email}
          </p>
        </div>

        <form action={salir}>
          <button
            type="submit"
            className="rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Cerrar sesión
          </button>
        </form>
      </div>

      <section className="mt-10">
        <h2 className="display text-2xl">Tus pedidos</h2>

        {pedidos.length === 0 ? (
          <div className="tarjeta mt-5 p-10 text-center">
            <Package className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <p className="display mt-4 text-xl">Todavía no has pedido nada</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Si compraste sin cuenta, ese pedido no aparece aquí.
              {whatsapp && " Escríbenos por WhatsApp con el número y te lo consultamos."}
            </p>
            <Link href="/tienda/" className={cn(buttonVariants(), "mt-6")}>
              Ver la tienda
            </Link>
          </div>
        ) : (
          <ul className="mt-5 space-y-4">
            {pedidos.map((p) => (
              <li key={p.id} className="tarjeta p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="cifra text-lg">{p.numero}</p>
                    <p className="mt-0.5 text-xs text-[var(--texto-tenue)]">
                      {formatearFecha(p.creado)}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      TONO_ESTADO[p.estado] ?? TONO_ESTADO.pendiente
                    }`}
                  >
                    {ETIQUETAS_ESTADO[p.estado] ?? p.estado}
                  </span>
                </div>

                {p.articulos.length > 0 && (
                  <ul className="mt-4 space-y-1 border-t pt-4 text-sm">
                    {p.articulos.map((a, i) => (
                      <li key={i} className="flex justify-between gap-4">
                        <span className="text-[var(--texto-suave)]">
                          {a.cantidad} × {a.nombre}
                        </span>
                        <span className="cifra shrink-0">
                          {formatearCOP(a.precioCop * a.cantidad)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t pt-4">
                  <div className="text-sm text-[var(--texto-suave)]">
                    {p.destinatario && <p>Para {p.destinatario}</p>}
                    {p.fechaEntrega && (
                      <p className="text-xs text-[var(--texto-tenue)]">
                        Entrega {formatearFechaSola(p.fechaEntrega)}
                        {p.franja && ` · ${etiquetaFranja(p.franja)}`}
                      </p>
                    )}
                  </div>
                  <p className="cifra text-xl">{formatearCOP(p.totalCop)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
