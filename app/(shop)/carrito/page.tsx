import type { Metadata } from "next";

import { VistaCarrito } from "@/components/carrito/vista-carrito";
import { leerConfigTienda } from "@/lib/data/tienda";
import { listarComplementos } from "@/lib/data/catalogo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu carrito",
  // El carrito está en Disallow del robots.txt; el noindex es la segunda
  // barrera por si alguien lo enlaza desde fuera.
  robots: { index: false, follow: false },
};

export default async function PaginaCarrito() {
  // La configuración se lee en el servidor y baja como props. El costo de
  // envío nunca se codifica en el cliente: esa duplicación es la que hacía
  // que la interfaz mostrara un total y el servidor cobrara otro.
  const [config, complementos] = await Promise.all([
    leerConfigTienda(),
    listarComplementos(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="display text-3xl md:text-4xl">Tu carrito</h1>
      <VistaCarrito config={config} complementos={complementos} />
    </div>
  );
}
