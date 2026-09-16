import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import Link from "next/link";

import { PaginaLegal } from "@/components/legal/pagina-legal";
import { CONTACTO, SITIO } from "@/lib/sitio";
import { DatosMigas } from "@/components/seo/datos-estructurados";
import { TIENDA } from "@/tienda.config";

// El menú del layout raíz depende de la base (ver categoriasMenu en
// app/layout.tsx): sin esto, el build sin DATABASE_URL congelaría el menú
// vacío en el HTML de esta página.
export const dynamic = "force-dynamic";

export const metadata: Metadata = metadatosDePagina({
  titulo: "Política de devoluciones",
  descripcion: `Cómo funcionan los cambios, devoluciones y reembolsos en ${TIENDA.nombre}.`,
  ruta: "/politica-de-devoluciones/",
});

const { legal } = TIENDA;
const razonSocial = legal.razonSocial ?? SITIO.nombre;
// `Number(...)` despliega el tipo literal (`2`) a `number`: sin esto, TS
// marca `=== 1` como comparación imposible cuando el valor de fábrica no es 1.
const plazoReporteDias: number = legal.plazoReporteDias;

export default function PoliticaDevoluciones() {
  return (
    <>
      <DatosMigas
        migas={[
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Política de devoluciones", ruta: "/politica-de-devoluciones/" },
        ]}
      />
      <PaginaLegal titulo="Política de devoluciones" actualizado={legal.actualizado}>
        <p>
          Si algo salió mal con tu pedido queremos saberlo y resolverlo. Esta página
          explica cómo, en cuánto tiempo y qué esperar.
        </p>

        <h2>Lo primero: escríbenos pronto</h2>
        <p>
          El plazo para reportar un problema con tu pedido es de{" "}
          <strong>
            {plazoReporteDias} {plazoReporteDias === 1 ? "día" : "días"}
          </strong>{" "}
          desde la entrega.
        </p>
        <p>
          Escríbenos con el número del pedido y, si aplica,{" "}
          <strong>fotos de lo que recibiste</strong>. Las fotos no son un trámite: son lo
          que nos permite ver qué pasó y responderte rápido.
        </p>

        <h2>Qué cubrimos</h2>
        <p>
          Tienes garantía legal conforme a los artículos 7 y 8 de la Ley 1480 de 2011.
          Respondemos cuando:
        </p>
        <ul>
          <li>El pedido llegó en mal estado o dañado en el transporte.</li>
          <li>Faltó algo de lo que anunciaba la ficha del producto.</li>
          <li>Se entregó un producto distinto al que compraste.</li>
          <li>El pedido no llegó, o llegó fuera de la franja acordada por causa nuestra.</li>
        </ul>

        <h2>Qué no cubrimos</h2>
        <ul>
          <li>
            <strong>Datos de entrega errados.</strong> Si la dirección o el teléfono de
            quien recibe estaban mal, ver la{" "}
            <Link href="/politica-de-entrega/">política de entrega</Link>.
          </li>
          <li>
            <strong>Que no gustara.</strong> El gusto no es un defecto. Si tienes dudas
            sobre qué escoger, escríbenos antes de comprar.
          </li>
          <li>
            <strong>Variaciones normales del catálogo.</strong> {legal.descripcionCatalogo}{" "}
            Podemos reemplazar un elemento por otro de valor y calidad equivalentes; si el
            cambio es significativo te avisamos antes.
          </li>
        </ul>

        <h2>Cómo lo resolvemos</h2>
        <p>Según el caso, y de acuerdo contigo:</p>
        <ol>
          <li>
            <strong>Reponemos el producto</strong> sin costo. Es lo que hacemos casi
            siempre y lo más rápido.
          </li>
          <li>
            <strong>Corregimos lo que faltó</strong> o completamos el pedido.
          </li>
          <li>
            <strong>Bono</strong> por el valor, para una compra próxima.
          </li>
          <li>
            <strong>Devolución del dinero</strong>, cuando ninguna de las anteriores tiene
            sentido.
          </li>
        </ol>
        <p>
          Respondemos dentro de las {legal.plazoRespuestaReclamoHoras} horas hábiles
          siguientes a tu reclamo.
        </p>

        <h2>Cómo se devuelve el dinero</h2>
        <ul>
          <li>Al mismo medio con el que se pagó, siempre que sea posible.</li>
          <li>
            Si el pago fue con tarjeta o PSE, el tiempo que tarde en reflejarse depende de
            tu banco, no de nosotros.
          </li>
          <li>
            Para transferencia necesitamos certificación bancaria a nombre de quien pagó.
          </li>
          <li>
            <strong>No hacemos devoluciones en efectivo.</strong>
          </li>
        </ul>
        <p>
          Procesamos la devolución en un máximo de {legal.plazoReembolsoDiasHabiles} días
          hábiles desde que se aprueba. El tiempo que tarde en reflejarse en tu cuenta
          depende de tu banco.
        </p>

        <h2>Derecho de retracto</h2>
        <p>
          El artículo 47 de la Ley 1480 de 2011 concede cinco días hábiles para
          retractarse en ventas a distancia, y ese mismo artículo{" "}
          <strong>exceptúa los bienes perecederos y los hechos a la medida</strong> o
          conforme a especificaciones del consumidor.
        </p>
        {legal.exceptuaRetracto ? (
          <p>
            {legal.descripcionCatalogo} Por eso{" "}
            <strong>no aplica el derecho de retracto</strong> una vez el pedido entra en
            preparación. Antes de que entre en preparación sí puedes cancelar con
            devolución del valor pagado. Ver la{" "}
            <Link href="/politica-de-entrega/">política de entrega</Link>.
          </p>
        ) : (
          <p>
            Nuestro catálogo no cae en esa excepción, así que{" "}
            <strong>sí tienes derecho de retracto</strong>: puedes desistir de la compra
            dentro de los cinco días hábiles siguientes a la entrega, sin tener que dar
            explicación, devolviendo el producto en las mismas condiciones en que lo
            recibiste.
          </p>
        )}

        <h2>Reversión del pago</h2>
        <p>
          Conforme al artículo 51 de la Ley 1480 de 2011, puedes pedir la reversión del
          pago cuando la compra sea objeto de fraude, cuando el producto no corresponda a
          lo solicitado o cuando no sea entregado. La solicitud se presenta ante nosotros y
          ante la entidad emisora de tu medio de pago, dentro de los cinco días hábiles
          siguientes a que tengas conocimiento del hecho.
        </p>

        <h2>Escríbenos</h2>
        <p>
          {CONTACTO.whatsapp && (
            <>
              WhatsApp: <strong>{CONTACTO.whatsappFormateado}</strong>
              <br />
            </>
          )}
          {CONTACTO.telefonoFormateado && (
            <>
              Teléfono: <strong>{CONTACTO.telefonoFormateado}</strong>
              <br />
            </>
          )}
          Correo: <a href={`mailto:${CONTACTO.correo}`}>{CONTACTO.correo}</a>
        </p>
        <p>
          Incluye siempre el <strong>número del pedido</strong> y fotos si aplica. Con eso
          resolvemos mucho más rápido.
        </p>
        <p>
          Si no quedas conforme con nuestra respuesta, puedes presentar una queja ante la{" "}
          <strong>Superintendencia de Industria y Comercio</strong>.
        </p>
        <p className="text-sm">
          {razonSocial}
          {legal.nit ? ` · NIT ${legal.nit}` : ""} · {legal.domicilio}
        </p>
      </PaginaLegal>
    </>
  );
}
