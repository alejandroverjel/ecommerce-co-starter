import type { ConfigTienda } from "@/lib/envio";
import type { ProductoComplemento } from "@/lib/data/catalogo";
import { PanelCarrito } from "@/components/carrito/panel-carrito";

/**
 * Puente servidor→cliente del drawer del carrito.
 *
 * El empujón de envío gratis necesita el umbral real de `store_settings`
 * (codificarlo en el cliente es el error que documenta lib/envio.ts).
 *
 * LA BASE SE IMPORTA DENTRO DE LA FUNCIÓN, no arriba. Este componente vive en
 * el layout raíz, que Next también renderiza para /_not-found al construir la
 * imagen, y ahí no hay base de datos: `lib/db` LANZA al importarse cuando falta
 * DATABASE_URL, así que un import estático tumbaba el build entero antes de
 * que el try/catch pudiera hacer nada. Con el import diferido, el fallo ocurre
 * dentro del try y se degrada como debe: sin config, el drawer no muestra el
 * empujón y todo lo demás funciona.
 */
export async function PanelCarritoServidor() {
  let config: ConfigTienda | null = null;
  let complementos: ProductoComplemento[] = [];
  try {
    const [{ leerConfigTienda }, { listarComplementos }] = await Promise.all([
      import("@/lib/data/tienda"),
      import("@/lib/data/catalogo"),
    ]);
    [config, complementos] = await Promise.all([
      leerConfigTienda(),
      listarComplementos(),
    ]);
  } catch {
    // Sin base (build de la imagen) o sin seed: el drawer funciona igual.
  }
  return <PanelCarrito config={config} complementos={complementos} />;
}
