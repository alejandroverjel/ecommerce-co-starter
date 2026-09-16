import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";

import { PaginaLegal } from "@/components/legal/pagina-legal";
import { CONTACTO, SITIO } from "@/lib/sitio";
import { DatosMigas } from "@/components/seo/datos-estructurados";
import { HAY_ANALITICA } from "@/lib/analitica/config";
import { TIENDA } from "@/tienda.config";

// El menú del layout raíz depende de la base (ver categoriasMenu en
// app/layout.tsx): sin esto, el build sin DATABASE_URL congelaría el menú
// vacío en el HTML de esta página.
export const dynamic = "force-dynamic";

export const metadata: Metadata = metadatosDePagina({
  titulo: "Política de privacidad",
  descripcion: "Qué datos personales tratamos, para qué y cómo ejercer tus derechos.",
  ruta: "/politica-de-privacidad/",
});

const { legal, checkout } = TIENDA;
const razonSocial = legal.razonSocial ?? SITIO.nombre;

export default function Privacidad() {
  return (
    <>
      <DatosMigas
        migas={[
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Política de privacidad", ruta: "/politica-de-privacidad/" },
        ]}
      />
      <PaginaLegal titulo="Política de privacidad" actualizado={legal.actualizado}>
        <p>
          Esta política explica cómo <strong>{razonSocial}</strong>, con domicilio en{" "}
          {legal.domicilio}, recoge y usa tus datos personales. Se rige por la{" "}
          <strong>Ley 1581 de 2012</strong> y el Decreto 1074 de 2015.
        </p>
        <p>
          Responsable del tratamiento: {razonSocial}
          {legal.nit ? ` (NIT ${legal.nit})` : ""}. Contacto para asuntos de datos:{" "}
          <a href={`mailto:${CONTACTO.correo}`}>{CONTACTO.correo}</a>
          {CONTACTO.telefonoFormateado && <> o {CONTACTO.telefonoFormateado}</>}.
        </p>

        <h2>Qué datos recogemos</h2>

        <h3>Cuando haces un pedido</h3>
        <ul>
          <li>Tu nombre, correo y teléfono.</li>
          {checkout.destinatarioDistinto && (
            <li>
              <strong>Nombre y teléfono de quien recibe el pedido</strong>, y la dirección
              de entrega.
            </li>
          )}
          <li>La fecha y franja de entrega que escoges.</li>
          {checkout.mensajeRegalo && (
            <li>
              El <strong>mensaje que escribes en la tarjeta</strong>.
            </li>
          )}
          <li>Qué compraste y por cuánto.</li>
        </ul>

        <h3>Si creas una cuenta</h3>
        <ul>
          <li>Tu nombre y correo.</li>
          <li>
            Tu contraseña, guardada <strong>cifrada con argon2id</strong>. No la
            conocemos ni podemos recuperarla; solo restablecerla.
          </li>
        </ul>

        <h3>Lo que no recogemos</h3>
        <p>
          <strong>Nunca vemos ni guardamos los datos de tu tarjeta.</strong> El pago lo
          procesa una pasarela externa en su propia plataforma. De la transacción solo
          conservamos el identificador que nos devuelve la pasarela y el estado del pago.
        </p>

        {checkout.destinatarioDistinto && (
          <>
            <h2>Datos de terceros que tú nos das</h2>
            <p>
              Cuando compras para otra persona nos entregas datos de{" "}
              <strong>otra persona</strong>: el nombre, el teléfono y la dirección de
              quien lo recibe.
            </p>
            <p>
              Al hacerlo declaras que tienes autorización para compartirlos. Los usamos
              únicamente para entregar ese pedido: no los sumamos a listas de correo ni
              los usamos para publicidad.
            </p>
          </>
        )}

        <h2>Para qué los usamos</h2>
        <ul>
          <li>Preparar y entregar tu pedido.</li>
          {checkout.mensajeRegalo && <li>Escribir a mano la tarjeta con tu mensaje.</li>}
          <li>Contactarte a ti o a quien recibe para coordinar la entrega.</li>
          <li>Cobrar y, si aplica, reembolsar.</li>
          <li>Atender reclamos y cumplir la garantía legal.</li>
          <li>Cumplir obligaciones contables y tributarias.</li>
        </ul>
        <p>
          <strong>No vendemos tus datos.</strong> No los cedemos a terceros para
          publicidad.
        </p>

        <h2>Quién más los ve</h2>
        <ul>
          <li>
            <strong>La pasarela de pagos</strong>, para procesar el cobro. Recibe tu
            nombre, correo y el monto.
          </li>
          <li>
            <strong>El proveedor de correo transaccional</strong>, para enviarte la
            confirmación del pedido.
          </li>
          <li>
            <strong>Quien hace la entrega</strong>, que necesita el nombre, teléfono y
            dirección de quien recibe.
          </li>
          <li>Autoridades, cuando la ley lo exija.</li>
        </ul>
        <p>
          Hoy son: <strong>Mercado Pago y/o Wompi</strong>, según las pasarelas activas,
          que procesan los pagos, y <strong>Resend</strong>, que envía los correos de
          confirmación del pedido. Ninguno recibe más datos de los que necesita para su
          función.
        </p>

        <h2>Dónde se guardan</h2>
        <p>
          En un servidor propio. La base de datos <strong>no está expuesta a internet</strong>:
          vive en una red privada a la que solo llega la aplicación de esta tienda. La
          conexión con el sitio va cifrada con HTTPS.
        </p>

        <h2>Cuánto tiempo</h2>
        <ul>
          <li>
            Datos de pedidos: mientras dure la relación comercial y el tiempo que exijan
            las obligaciones contables y tributarias.
          </li>
          <li>Datos de tu cuenta: hasta que pidas eliminarla.</li>
          {checkout.mensajeRegalo && (
            <li>
              El mensaje de la tarjeta: se conserva junto al pedido como parte del
              historial.
            </li>
          )}
        </ul>

        <h2>Tus derechos</h2>
        <p>Conforme al artículo 8 de la Ley 1581 de 2012, puedes:</p>
        <ul>
          <li>
            <strong>Conocer</strong> qué datos tuyos tenemos.
          </li>
          <li>
            <strong>Actualizarlos</strong> o <strong>rectificarlos</strong> si están mal.
          </li>
          <li>
            <strong>Solicitar prueba</strong> de la autorización que nos diste.
          </li>
          <li>
            <strong>Revocar la autorización</strong> o pedir que se supriman tus datos,
            salvo cuando exista un deber legal o contractual de conservarlos.
          </li>
          <li>
            <strong>Presentar quejas</strong> ante la Superintendencia de Industria y
            Comercio.
          </li>
          <li>Acceder gratuitamente a tus datos.</li>
        </ul>

        <h3>Cómo ejercerlos</h3>
        <p>
          Escríbenos a <a href={`mailto:${CONTACTO.correo}`}>{CONTACTO.correo}</a> con tu
          nombre, un dato de contacto y qué quieres pedir.
        </p>
        <p>
          Respondemos las consultas en un máximo de <strong>diez días hábiles</strong> y
          los reclamos en un máximo de <strong>quince días hábiles</strong>, conforme a los
          artículos 14 y 15 de la Ley 1581 de 2012.
        </p>

        <h2>Cookies</h2>
        <p>Este sitio usa el mínimo necesario:</p>
        <ul>
          <li>
            <strong>Sesión</strong>: si inicias sesión, una cookie mantiene tu sesión
            abierta. Es <em>httpOnly</em>, así que el JavaScript de la página no puede
            leerla.
          </li>
          <li>
            <strong>Carrito</strong>: lo que agregas se guarda en tu navegador, no en
            nuestro servidor. Se borra al vaciar los datos del sitio.
          </li>
        </ul>
        {HAY_ANALITICA && (
          <>
            <h3>Medición y publicidad</h3>
            <p>
              Usamos herramientas de medición de Google (Analytics y/o Ads) para saber
              qué páginas se visitan y si nuestros anuncios funcionan. Reciben datos como
              tu dirección IP, el navegador y las páginas que ves. No les enviamos tu
              nombre, tu teléfono ni tu dirección.
            </p>
            <p>
              <strong>Solo se activan si aceptas.</strong> Al entrar por primera vez verás
              un aviso: si eliges «solo lo esencial», estas herramientas no se cargan y el
              sitio funciona igual. Puedes cambiar de opinión borrando los datos del sitio
              en tu navegador, y el aviso volverá a aparecer.
            </p>
          </>
        )}

        <h2>Menores de edad</h2>
        <p>
          Este sitio no está dirigido a menores de edad y no recogemos sus datos a
          sabiendas. Si crees que un menor nos entregó datos, escríbenos y los eliminamos.
        </p>

        <h2>Cambios</h2>
        <p>
          Podemos actualizar esta política. La fecha de la última actualización aparece al
          inicio. Si el cambio es sustancial, lo avisaremos por los medios de contacto que
          tengamos.
        </p>
      </PaginaLegal>
    </>
  );
}
