import type { Metadata } from "next";

import { metadatosDePagina } from "@/lib/seo";
import { preguntasFrecuentes } from "@/lib/preguntas";
import { leerConfigTienda } from "@/lib/data/tienda";
import { PreguntasAcordeon } from "@/components/preguntas-acordeon";
import { DatosPreguntas } from "@/components/seo/datos-estructurados";
import Link from "next/link";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { DatosMigas } from "@/components/seo/datos-estructurados";
import { CONTACTO, REDES, enlaceWhatsapp } from "@/lib/sitio";
import { cn } from "@/lib/utils";
import { TIENDA } from "@/tienda.config";

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

export const metadata: Metadata = metadatosDePagina({
  titulo: "Contáctenos",
  descripcion: `Canales de contacto, horario y cobertura de ${TIENDA.nombre}.`,
  ruta: "/contactenos/",
});

export default async function Contactenos() {
  // El costo del domicilio sale de la configuración real de la tienda, no de
  // un número escrito a mano que se queda viejo.
  const preguntas = preguntasFrecuentes(await leerConfigTienda());

  const whatsapp = enlaceWhatsapp();
  const hayHorario = TIENDA.horarioAtencion.length > 0;

  return (
    <>
      <DatosMigas
        migas={[
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Contáctenos", ruta: "/contactenos/" },
        ]}
      />
      {preguntas.length > 0 && <DatosPreguntas preguntas={preguntas} />}

      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl md:text-4xl">Hablemos</h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Si tienes dudas, quieres algo armado a tu gusto o necesitas coordinar una
          entrega, escríbenos. Respondemos rápido.
        </p>

        {/* Canales condicionados: sin WhatsApp o sin teléfono, ese botón no se
            pinta en vez de apuntar a un contacto que no existe. */}
        {(whatsapp || CONTACTO.telefono) && (
          <div className="mt-9 flex flex-wrap gap-3">
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ size: "lg" }))}
              >
                <MessageCircle className="size-5" aria-hidden />
                Escribir por WhatsApp
              </a>
            )}
            {CONTACTO.telefono && (
              <a
                href={`tel:${CONTACTO.telefonoInternacional}`}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                <Phone className="size-5" aria-hidden />
                {CONTACTO.telefonoFormateado}
              </a>
            )}
          </div>
        )}

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {hayHorario && (
            <div className="tarjeta p-6">
              <h2 className="flex items-center gap-2 font-medium">
                <Clock className="size-4 text-primary" aria-hidden />
                Horario
              </h2>
              <dl className="mt-4 space-y-1.5 text-sm">
                {TIENDA.horarioAtencion.map((h) => (
                  <div key={h.etiqueta} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{h.etiqueta}</dt>
                    <dd>
                      {h.abre} – {h.cierra}
                    </dd>
                  </div>
                ))}
              </dl>
              {whatsapp && (
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Fuera de horario puedes escribir por WhatsApp y respondemos apenas
                  abrimos.
                </p>
              )}
            </div>
          )}

          <div className="tarjeta p-6">
            <h2 className="flex items-center gap-2 font-medium">
              <MapPin className="size-4 text-primary" aria-hidden />
              Dónde entregamos
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {TIENDA.cobertura.descripcion}:
            </p>
            <p className="mt-2 text-sm">{TIENDA.cobertura.municipios.join(" · ")}</p>
            {whatsapp && (
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                ¿Necesitas una entrega fuera de esta zona? Escríbenos y miramos si se
                puede.
              </p>
            )}
          </div>

          <div className="tarjeta p-6">
            <h2 className="flex items-center gap-2 font-medium">
              <Mail className="size-4 text-primary" aria-hidden />
              Correo
            </h2>
            <a href={`mailto:${CONTACTO.correo}`} className="mt-4 inline-block text-sm hover:text-primary">
              {CONTACTO.correo}
            </a>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Para facturación o pedidos corporativos.
            </p>
          </div>

          {REDES.length > 0 && (
            <div className="tarjeta p-6">
              <h2 className="font-medium">Síguenos</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {REDES.map((r) => (
                  <li key={r.nombre}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary"
                    >
                      {r.nombre}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Preguntas frecuentes reales, sacadas de lo que la tienda ya responde
            en el catálogo y en el canal de contacto. */}
        {preguntas.length > 0 && (
          <section className="mt-14">
            <div className="tarjeta p-8 sm:p-10">
              <PreguntasAcordeon preguntas={preguntas} nombre="faq-contacto" />
            </div>
          </section>
        )}

        <p className="mt-12 text-sm text-muted-foreground">
          ¿Buscas algo en particular?{" "}
          <Link href="/tienda/" className="font-medium underline">
            Mira el catálogo
          </Link>
          .
        </p>
      </div>
    </>
  );
}
