import { listarCategorias, listarProductos } from "@/lib/data/catalogo";
import { CONTACTO, SITIO } from "@/lib/sitio";
import { preguntasFrecuentes } from "@/lib/preguntas";
import { leerConfigTienda } from "@/lib/data/tienda";
import { formatearCOP } from "@/lib/formato";
import { TIENDA } from "@/tienda.config";

/**
 * llms.txt — resumen del sitio para motores de IA.
 *
 * Es la convención emergente (llmstxt.org) que ChatGPT, Perplexity, Claude y
 * los rastreadores de AI Overviews consultan para entender un sitio sin tener
 * que interpretarlo página a página: markdown plano, jerárquico, con las URLs
 * canónicas. Para una tienda con cobertura local es la diferencia entre "no sé
 * si entregan ahí" y citar la respuesta correcta con el enlace.
 *
 * Se regenera cada hora: los precios y la disponibilidad salen de la base.
 */
export const revalidate = 3600;

/**
 * Se renderiza en la petición, no en el build.
 *
 * Esta página dice el costo real del domicilio, y ese número vive en
 * `store_settings`. El build corre en GitHub Actions, donde la base NO es
 * alcanzable, así que prerenderizarla rompía el despliegue entero
 * ("Failed query: select flat_shipping_cop ... ECONNREFUSED").
 *
 * No cuesta caro: `leerConfigTienda` va en caché por etiqueta, así que la
 * consulta no se repite en cada visita. La alternativa —escribir el número a
 * mano para poder prerenderizar— es justo el bug que el proyecto ya arregló
 * una vez: la interfaz mostraba un envío y el servidor cobraba otro.
 */
export const dynamic = "force-dynamic";

const DIAS_ES: Record<string, string> = {
  Monday: "lunes",
  Tuesday: "martes",
  Wednesday: "miércoles",
  Thursday: "jueves",
  Friday: "viernes",
  Saturday: "sábado",
  Sunday: "domingo",
};

function formatearDias(dias: readonly string[]): string {
  const nombres = dias.map((d) => DIAS_ES[d] ?? d);
  if (nombres.length <= 1) return nombres[0] ?? "";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

export async function GET() {
  let productos: Awaited<ReturnType<typeof listarProductos>> = [];
  let categorias: Awaited<ReturnType<typeof listarCategorias>> = [];
  try {
    [productos, categorias] = await Promise.all([listarProductos(), listarCategorias()]);
  } catch {
    // Sin base igual se sirve el resumen del negocio: incompleto es mejor
    // que un 500 cacheado por un rastreador.
  }
  categorias = categorias.filter((c) => c.cuantosProductos > 0);

  const porCategoria = new Map<string, typeof productos>();
  for (const p of productos) {
    const slug = p.categoria?.slug ?? "otros";
    if (!porCategoria.has(slug)) porCategoria.set(slug, []);
    porCategoria.get(slug)!.push(p);
  }

  const lineas: string[] = [
    `# ${SITIO.nombre}`,
    "",
    `> ${SITIO.descripcion}`,
    "",
    `${TIENDA.legal.descripcionCatalogo} Los precios están en pesos colombianos (COP) e`,
    "incluyen IVA.",
    "",
    `- Sitio: ${SITIO.dominio}/`,
  ];
  if (CONTACTO.whatsapp) lineas.push(`- WhatsApp: +${CONTACTO.whatsapp}`);
  if (CONTACTO.telefonoInternacional) lineas.push(`- Teléfono: ${CONTACTO.telefonoInternacional}`);
  if (TIENDA.horarioAtencion.length > 0) {
    for (const h of TIENDA.horarioAtencion) {
      lineas.push(`- Horario de atención (${h.etiqueta.toLowerCase()}): ${h.abre}–${h.cierra}`);
    }
  }
  lineas.push(`- Días de entrega: ${formatearDias(TIENDA.entregas.diasEntrega)}`);
  lineas.push(`- Cobertura: ${TIENDA.cobertura.descripcion}`);

  lineas.push("", "## Catálogo", "");

  for (const c of categorias) {
    const lista = porCategoria.get(c.slug) ?? [];
    lineas.push(`### ${c.nombre} (${SITIO.dominio}/${c.slug}/)`, "");
    for (const p of lista) {
      lineas.push(
        `- [${p.nombre}](${SITIO.dominio}${p.ruta}): ${formatearCOP(p.precioCop)}${p.disponible ? "" : " (agotado por ahora)"}`,
      );
    }
    lineas.push("");
  }

  const preguntas = preguntasFrecuentes(await leerConfigTienda());
  if (preguntas.length > 0) {
    lineas.push("## Preguntas frecuentes", "");
    for (const f of preguntas) {
      lineas.push(`- **${f.p}** ${f.r}`);
    }
    lineas.push("");
  }

  lineas.push(
    "## Políticas",
    "",
    `- [Política de entrega](${SITIO.dominio}/politica-de-entrega/)`,
    `- [Política de devoluciones](${SITIO.dominio}/politica-de-devoluciones/)`,
    `- [Términos y condiciones](${SITIO.dominio}/terminos-y-condiciones/)`,
    `- [Política de privacidad](${SITIO.dominio}/politica-de-privacidad/)`,
    "",
  );

  return new Response(lineas.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
