import { ChevronDown } from "lucide-react";

/**
 * Preguntas frecuentes en acordeón.
 *
 * Usa <details>/<summary> nativos: accesible y sin JavaScript. La primera va
 * abierta (open) y el resto cerradas. El atributo `name` agrupa las tarjetas
 * para que solo una quede abierta a la vez (comportamiento acordeón); en
 * navegadores viejos que lo ignoran, simplemente se pueden abrir varias, que
 * es una degradación aceptable.
 */
export function PreguntasAcordeon({
  preguntas,
  nombre,
  titulo = "Preguntas frecuentes",
}: {
  preguntas: ReadonlyArray<{ p: string; r: string }>;
  /** Agrupa el acordeón; debe ser único por página si hay más de uno. */
  nombre: string;
  titulo?: string;
}) {
  return (
    <>
      <h2 className="display text-3xl">{titulo}</h2>

      <div className="mt-7 divide-y divide-[var(--borde)]">
        {preguntas.map((f, i) => (
          <details
            key={f.p}
            name={nombre}
            open={i === 0}
            className="group py-5 first:pt-0 last:pb-0"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-[var(--texto)] [&::-webkit-details-marker]:hidden">
              {f.p}
              <ChevronDown
                className="size-5 shrink-0 text-[var(--texto-tenue)] transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="mt-3 leading-relaxed text-[var(--texto-suave)]">{f.r}</p>
          </details>
        ))}
      </div>
    </>
  );
}
