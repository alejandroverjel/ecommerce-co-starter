import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import Link from "next/link";

import { PaginaLegal } from "@/components/legal/pagina-legal";
import { CONTACTO, SITIO } from "@/lib/sitio";
import { ANTICIPACION_MINIMA_DIAS, HORA_CORTE, MUNICIPIOS } from "@/lib/validaciones/pedido";
import { DatosMigas } from "@/components/seo/datos-estructurados";
import { TIENDA } from "@/tienda.config";

// El menú del layout raíz depende de la base (ver categoriasMenu en
// app/layout.tsx): sin esto, el build sin DATABASE_URL congelaría el menú
// vacío en el HTML de esta página.
export const dynamic = "force-dynamic";

export const metadata: Metadata = metadatosDePagina({
  titulo: "Política de entrega",
  descripcion: `Zonas, horarios y condiciones de entrega de ${TIENDA.nombre}.`,
  ruta: "/politica-de-entrega/",
});

const DIAS_ES: Record<string, string> = {
  Monday: "lunes",
  Tuesday: "martes",
  Wednesday: "miércoles",
  Thursday: "jueves",
  Friday: "viernes",
  Saturday: "sábado",
  Sunday: "domingo",
};

/** "[Monday, Tuesday, Saturday]" -> "lunes, martes y sábado". */
function formatearDias(dias: readonly string[]): string {
  const nombres = dias.map((d) => DIAS_ES[d] ?? d);
  if (nombres.length <= 1) return nombres[0] ?? "";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

export default function PoliticaEntrega() {
  const { entregas, checkout } = TIENDA;

  return (
    <>
      <DatosMigas
        migas={[
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Política de entrega", ruta: "/politica-de-entrega/" },
        ]}
      />
      <PaginaLegal titulo="Política de entrega" actualizado={TIENDA.legal.actualizado}>
        <p>
          Aquí está todo lo que hay que saber sobre cómo y cuándo llega un pedido de{" "}
          <strong>{SITIO.nombre}</strong>.
          {CONTACTO.telefonoFormateado && (
            <> Si algo no queda claro, escríbenos al {CONTACTO.telefonoFormateado} antes de comprar.</>
          )}
        </p>

        <h2>Dónde entregamos</h2>
        <p>
          {TIENDA.cobertura.descripcion}: <strong>{MUNICIPIOS.join(", ")}</strong>.
        </p>
        <p>
          Fuera de esa zona no entregamos por catálogo. Escríbenos y miramos si es
          posible con un costo distinto.
        </p>

        <h2>Costo del envío</h2>
        <ul>
          <li>
            Tarifa plana dentro de la zona de cobertura. El valor exacto aparece en el
            carrito <strong>antes de pagar</strong>, nunca como sorpresa al final.
          </li>
          <li>
            A partir de cierto monto el envío es <strong>gratis</strong>. El carrito te
            dice cuánto te falta para alcanzarlo.
          </li>
          <li>El precio que ves es el final: no se suma nada al pagar.</li>
        </ul>

        <h2>Cuándo entregamos</h2>
        <p>
          Al finalizar la compra escoges <strong>fecha y franja horaria</strong>:
        </p>
        <ul>
          {entregas.franjas.map((f) => (
            <li key={f.valor}>
              <strong>{f.etiqueta}:</strong> entre {f.desde} y {f.hasta}
            </li>
          ))}
        </ul>
        <p>
          {entregas.permitirHora ? (
            <>
              Si necesitas una hora puntual, puedes indicarla en el checkout y hacemos lo
              posible por cumplirla; aun así, el tráfico y la ruta del día pueden mover
              el estimado.
            </>
          ) : (
            <>
              Son <strong>rangos, no una hora exacta</strong>: el orden de la ruta depende
              del tráfico y de las direcciones del día. Si necesitas una hora puntual,
              escríbenos y lo coordinamos aparte.
            </>
          )}
        </p>
        <p>
          Puedes programar la entrega con hasta {entregas.diasMaximos} días de
          anticipación. Los días de entrega son {formatearDias(entregas.diasEntrega)}.
        </p>

        {ANTICIPACION_MINIMA_DIAS === 0 ? (
          <>
            <h3>Pedidos para el mismo día</h3>
            <p>
              Se pueden hacer dentro del horario de atención, sujetos a disponibilidad.
              Entre más temprano entre el pedido, más franjas quedan libres.
            </p>
            <p>
              <strong>
                Los pedidos que entren antes de las {HORA_CORTE}, en días de entrega, se
                entregan el mismo día
              </strong>{" "}
              dentro de la zona de cobertura, sujetos a disponibilidad de franjas. Después
              de esa hora la entrega pasa al siguiente día hábil.
            </p>
          </>
        ) : (
          <>
            <h3>Cuánto se demora en llegar</h3>
            <p>
              Por los tiempos de preparación y de envío, la fecha más próxima que el
              checkout ofrece es, como mínimo,{" "}
              <strong>
                {ANTICIPACION_MINIMA_DIAS} día{ANTICIPACION_MINIMA_DIAS === 1 ? "" : "s"}
              </strong>{" "}
              después de hacer el pedido, en el primer día de entrega disponible desde
              entonces.
            </p>
          </>
        )}

        <h2>La dirección</h2>
        <p>
          La entrega se hace <strong>exactamente en la dirección que registres</strong>.
          Vale la pena escribirla completa: barrio, torre, apartamento, punto de
          referencia. En el checkout hay un campo de indicaciones para la entrega
          justamente para eso.
        </p>
        <p>
          Una dirección incompleta o equivocada puede retrasar la entrega o impedirla. En
          ese caso el pedido regresa y aplica lo del segundo intento.
        </p>

        {checkout.destinatarioDistinto && (
          <>
            <h2>Quién recibe</h2>
            <p>
              Casi nunca es quien compra: por eso pedimos el{" "}
              <strong>nombre y el teléfono de quien recibe</strong>, no solo los tuyos.
            </p>
            <p>Quien entrega llama a ese número al llegar. Es importante que esté correcto.</p>
          </>
        )}

        <h2>Si no hay quien reciba</h2>
        <ol>
          <li>Quien entrega llama al teléfono de contacto del pedido.</li>
          <li>Si hay portería, se deja allí y te avisamos.</li>
          {CONTACTO.whatsapp && (
            <li>
              Si no hay portería y nadie contesta, te escribimos por WhatsApp para
              resolverlo en el momento.
            </li>
          )}
          <li>Si nadie responde, el pedido regresa a nuestras instalaciones.</li>
        </ol>
        <p>
          <strong>Un segundo intento de entrega tiene costo adicional.</strong> Según el
          producto, puede que no se pueda garantizar que llegue en las mismas condiciones
          al día siguiente.
        </p>
        <p>
          El segundo intento se cobra antes de reprogramar. Si el pedido ya no está en
          condiciones de entregarse, te avisamos antes de rehacerlo.
        </p>

        <h2>Si se rechaza el pedido</h2>
        <p>
          Si quien recibe rechaza el pedido sin que haya un problema atribuible a nosotros,
          el costo del envío no se reembolsa.
        </p>

        <h2>Cambios o cancelaciones</h2>
        <p>
          Mientras el pedido <strong>no haya entrado en preparación</strong> podemos
          cambiar la fecha, la dirección{checkout.mensajeRegalo ? " o el mensaje de la tarjeta" : ""}{" "}
          sin costo.
          {CONTACTO.telefonoFormateado && <> Escríbenos al {CONTACTO.telefonoFormateado}.</>}
        </p>
        <p>
          Una vez armado no se puede modificar. Ver la{" "}
          <Link href="/politica-de-devoluciones/">política de devoluciones</Link>.
        </p>
        <p>
          <strong>
            Puedes cambiar o cancelar sin costo hasta {entregas.horasAntelacionCambio} horas
            antes de la franja de entrega.
          </strong>{" "}
          Dentro de ese plazo el pedido ya entró en preparación y no se puede modificar ni
          cancelar.
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
      </PaginaLegal>
    </>
  );
}
