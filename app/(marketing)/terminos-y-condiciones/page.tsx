import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import Link from "next/link";

import { PaginaLegal } from "@/components/legal/pagina-legal";
import { CONTACTO, SITIO } from "@/lib/sitio";
import { MUNICIPIOS } from "@/lib/validaciones/pedido";
import { DatosMigas } from "@/components/seo/datos-estructurados";
import { TIENDA } from "@/tienda.config";

// El menú del layout raíz depende de la base (ver categoriasMenu en
// app/layout.tsx): sin esto, el build sin DATABASE_URL congelaría el menú
// vacío en el HTML de esta página.
export const dynamic = "force-dynamic";

export const metadata: Metadata = metadatosDePagina({
  titulo: "Términos y condiciones",
  descripcion: `Condiciones de uso y de compra en la tienda de ${TIENDA.nombre}.`,
  ruta: "/terminos-y-condiciones/",
});

const { legal, entregas } = TIENDA;
const razonSocial = legal.razonSocial ?? SITIO.nombre;
// `number` despliega el tipo literal: sin esto, TS marca `=== 1` como
// comparación imposible cuando el valor de fábrica no es 1.
const plazoReporteDias: number = legal.plazoReporteDias;

export default function Terminos() {
  return (
    <>
      <DatosMigas
        migas={[
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Términos y condiciones", ruta: "/terminos-y-condiciones/" },
        ]}
      />
      <PaginaLegal titulo="Términos y condiciones" actualizado={legal.actualizado}>
        <p>
          Estas condiciones rigen las compras hechas en {SITIO.dominio}, operado por{" "}
          <strong>{razonSocial}</strong>
          {legal.nit ? ` (NIT ${legal.nit})` : ""}, con domicilio en {legal.domicilio}.
          Puedes identificarnos y contactarnos por los canales que aparecen al final de
          este documento.
        </p>
        <p>
          Al hacer un pedido aceptas lo que dice este documento.
          {(CONTACTO.telefonoFormateado || CONTACTO.correo) && (
            <>
              {" "}
              Si algo no te queda claro, escríbenos antes de comprar
              {CONTACTO.telefonoFormateado && <> al {CONTACTO.telefonoFormateado}</>}
              {CONTACTO.telefonoFormateado && " o a "}
              {!CONTACTO.telefonoFormateado && " a "}
              <a href={`mailto:${CONTACTO.correo}`}>{CONTACTO.correo}</a>.
            </>
          )}
        </p>

        <h2>Qué vendemos</h2>
        <p>{legal.descripcionCatalogo}</p>
        <p>
          Las fotos del catálogo son de referencia. Según la disponibilidad del día,
          podemos reemplazar un elemento por otro de valor y calidad equivalentes sin
          avisar previamente. Si el cambio es significativo, te escribimos antes de
          entregar.
        </p>

        <h2>Precios y pago</h2>
        <ul>
          <li>
            Todos los precios están en <strong>pesos colombianos (COP)</strong> y son
            el valor final: lo que ves es lo que pagas, sin cargos añadidos después.
          </li>
          <li>
            El costo de envío se calcula en el carrito antes de pagar, según el monto del
            pedido.
          </li>
          <li>
            El precio que se cobra es el que la tienda tiene registrado al momento de
            crear el pedido, no el que estuviera guardado en tu navegador.
          </li>
          <li>
            Los pagos se procesan a través de una pasarela externa.{" "}
            <strong>No almacenamos datos de tarjetas</strong> en ningún momento.
          </li>
          <li>
            El pedido se confirma cuando la pasarela nos reporta el pago aprobado. Hasta
            entonces queda como pendiente y no se despacha.
          </li>
        </ul>

        <h2>Entregas</h2>
        <p>
          {TIENDA.cobertura.descripcion}: {MUNICIPIOS.join(", ")}.
        </p>
        <ul>
          <li>
            Al comprar escoges <strong>fecha y franja horaria</strong>. Las franjas son
            rangos aproximados, no una hora exacta{entregas.permitirHora ? ", salvo que indiques una hora puntual en el checkout" : ""}.
          </li>
          <li>
            Quien entrega el pedido llama al teléfono de contacto. Es responsabilidad de
            quien compra que ese número y la dirección estén correctos.
          </li>
          <li>
            Si no hay quien reciba, intentamos contactarte. Si nadie responde, el pedido
            regresa a nuestras instalaciones y{" "}
            <strong>un segundo intento de entrega tiene costo adicional</strong>.
          </li>
          <li>
            Datos incompletos o errados en la dirección pueden retrasar o impedir la
            entrega. En ese caso no hay lugar a reembolso del producto.
          </li>
        </ul>

        <h2>Derecho de retracto</h2>
        <p>
          El artículo 47 de la Ley 1480 de 2011 concede cinco días hábiles para
          retractarse en las ventas a distancia. Ese mismo artículo{" "}
          <strong>exceptúa los bienes perecederos y los hechos a la medida</strong> o
          conforme a especificaciones del consumidor.
        </p>
        {legal.exceptuaRetracto ? (
          <p>
            {legal.descripcionCatalogo} Por esa razón{" "}
            <strong>no aplica el derecho de retracto</strong> una vez el pedido entra en
            preparación. Si el pedido todavía <strong>no ha entrado en preparación</strong>,
            escríbenos y lo cancelamos con devolución del valor pagado, siempre que nos
            escribas al menos {entregas.horasAntelacionCambio} horas antes de la franja de
            entrega.
          </p>
        ) : (
          <p>
            Nuestro catálogo no cae en esa excepción, así que{" "}
            <strong>sí tienes derecho de retracto</strong> dentro de los cinco días
            hábiles siguientes a la entrega, en los términos del artículo 47 de la Ley
            1480 de 2011.
          </p>
        )}

        <h2>Garantía, cambios y reclamos</h2>
        <p>
          Tienes garantía legal conforme a los artículos 7 y 8 de la Ley 1480 de 2011. Si
          el pedido llega en mal estado, incompleto o distinto a lo comprado:
        </p>
        <ul>
          <li>
            Escríbenos dentro de los{" "}
            {plazoReporteDias} {plazoReporteDias === 1 ? "día" : "días"}
            {" "}
            siguientes a la entrega
            {CONTACTO.telefonoFormateado && <> al {CONTACTO.telefonoFormateado}</>}.
          </li>
          <li>Envíanos fotos de lo recibido. Nos ayudan a resolver más rápido.</li>
          <li>
            Según el caso, reponemos el producto, corregimos lo que falte o devolvemos el
            valor correspondiente.
          </li>
        </ul>
        <p>
          Respondemos dentro de las {legal.plazoRespuestaReclamoHoras} horas hábiles
          siguientes a tu reclamo.
        </p>

        <h2>Reversión del pago</h2>
        <p>
          Conforme al artículo 51 de la Ley 1480 de 2011, puedes solicitar la reversión del
          pago cuando la compra sea objeto de fraude, cuando el producto no corresponda a
          lo solicitado o cuando no sea entregado. La solicitud se presenta ante nosotros y
          ante la entidad emisora de tu medio de pago dentro de los cinco días hábiles
          siguientes a que tengas conocimiento del hecho.
        </p>

        <h2>Cuenta de usuario</h2>
        <p>
          Puedes comprar sin crear cuenta. Si la creas, eres responsable de tu contraseña y
          de lo que se haga desde tu sesión. Avísanos si crees que alguien más entró a tu
          cuenta.
        </p>

        <h2>Propiedad intelectual</h2>
        <p>
          Las fotografías, textos y la marca de este sitio son propiedad de{" "}
          {SITIO.nombre}. No pueden reproducirse sin autorización escrita.
        </p>

        <h2>Datos personales</h2>
        <p>
          El tratamiento de tus datos se rige por nuestra{" "}
          <Link href="/politica-de-privacidad/">política de privacidad</Link>.
        </p>

        <h2>Ley aplicable</h2>
        <p>
          Estas condiciones se rigen por la ley colombiana. Las controversias se someten a
          los jueces competentes de {SITIO.ciudad}, sin perjuicio de que puedas presentar
          una queja ante la <strong>Superintendencia de Industria y Comercio</strong>.
        </p>

        <h2>Cambios a este documento</h2>
        <p>
          Podemos actualizar estas condiciones. La versión aplicable a tu compra es la que
          esté publicada el día en que hagas el pedido, y la fecha aparece al inicio de
          esta página.
        </p>
      </PaginaLegal>
    </>
  );
}
