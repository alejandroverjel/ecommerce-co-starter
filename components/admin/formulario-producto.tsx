"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  eliminarProducto,
  guardarProducto,
  type EstadoFormularioProducto,
} from "@/lib/admin/acciones-producto";
import type { CategoriaAdmin, FichaProductoAdmin } from "@/lib/data/admin";
import { formatearCOP, formatearFecha } from "@/lib/formato";
import {
  analizarEntero,
  campoVariante,
  ESTADOS_PRODUCTO,
} from "@/lib/validaciones/producto";

const claseCampo =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

const claseCampoMalo =
  "w-full rounded-xl border-2 border-[var(--peligro)] bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none";

type Props = {
  producto: FichaProductoAdmin;
  categorias: CategoriaAdmin[];
  /**
   * Retirar un producto es acción solo-admin en el servidor. A un staff no se
   * le pinta la Zona de peligro: dejarle escribir el nombre completo para
   * confirmar y estrellarse contra un "no autorizado" es una trampa.
   */
  esAdmin: boolean;
};

// ============================================================================
// Piezas sueltas
// ============================================================================

function ErrorCampo({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className="text-xs font-medium text-[var(--peligro)]">
      {mensaje}
    </p>
  );
}

function Seccion({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bloque border p-6">
      <h2 className="display text-xl">{titulo}</h2>
      {ayuda && <p className="mt-1 text-sm text-[var(--texto-suave)]">{ayuda}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

/** Campo de texto con contador. Los límites de SEO son una guía, no un tope:
 *  bloquear el guardado por un título largo impediría corregir un precio. */
function CampoContado({
  id,
  nombre,
  etiqueta,
  ayuda,
  recomendado,
  inicial,
  filas,
  error,
}: {
  id: string;
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  recomendado: number;
  inicial: string;
  filas?: number;
  error?: string;
}) {
  const [valor, setValor] = useState(inicial);
  const largo = valor.trim().length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {etiqueta}
        </label>
        <span
          className={`text-xs tabular-nums ${
            largo > recomendado ? "text-[var(--aviso)]" : "text-[var(--texto-tenue)]"
          }`}
        >
          {largo} / {recomendado} sugeridos
        </span>
      </div>
      {ayuda && <p className="text-xs text-[var(--texto-tenue)]">{ayuda}</p>}
      {filas ? (
        <textarea
          id={id}
          name={nombre}
          rows={filas}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className={error ? claseCampoMalo : claseCampo}
        />
      ) : (
        <input
          id={id}
          name={nombre}
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className={error ? claseCampoMalo : claseCampo}
        />
      )}
      <ErrorCampo mensaje={error} />
    </div>
  );
}

// ============================================================================
// Variante
// ============================================================================

function FilaVariante({
  variante,
  errores,
}: {
  variante: FichaProductoAdmin["variantes"][number];
  errores: Record<string, string>;
}) {
  const [precio, setPrecio] = useState(String(variante.precioCop));
  const [stock, setStock] = useState(String(variante.stock));

  const lectura = analizarEntero(precio);
  const nombreCampo = (campo: Parameters<typeof campoVariante>[1]) =>
    campoVariante(variante.id, campo);

  /** El stock nunca baja de cero: el CHECK de la base lo rechazaría igual, y
   *  es mejor que el botón simplemente no pueda hacerlo. */
  function ajustarStock(delta: number) {
    const actual = analizarEntero(stock).valor ?? 0;
    setStock(String(Math.max(0, actual + delta)));
  }

  return (
    <div className="rounded-[var(--radius-tarjeta)] border bg-[var(--fondo-hondo)] p-5">
      <input type="hidden" name={nombreCampo("version")} value={variante.version} />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* --- Nombre --- */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nombreCampo("nombre")} className="text-sm font-medium">
            Nombre de la variante
          </label>
          <input
            id={nombreCampo("nombre")}
            name={nombreCampo("nombre")}
            type="text"
            defaultValue={variante.nombre}
            className={errores[nombreCampo("nombre")] ? claseCampoMalo : claseCampo}
          />
          <ErrorCampo mensaje={errores[nombreCampo("nombre")]} />
        </div>

        {/* --- SKU --- */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nombreCampo("sku")} className="text-sm font-medium">
            SKU <span className="font-normal text-[var(--texto-tenue)]">(opcional)</span>
          </label>
          <input
            id={nombreCampo("sku")}
            name={nombreCampo("sku")}
            type="text"
            defaultValue={variante.sku ?? ""}
            placeholder="Sin SKU"
            className={errores[nombreCampo("sku")] ? claseCampoMalo : claseCampo}
          />
          <ErrorCampo mensaje={errores[nombreCampo("sku")]} />
        </div>

        {/* --- Precio --- */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nombreCampo("precio")} className="text-sm font-medium">
            Precio
          </label>
          {/* `inputMode` y no `type="number"`: con number el navegador rechaza
              los puntos de miles que la gente escribe, y en móvil las flechas
              cambian el precio por accidente al hacer scroll. */}
          <input
            id={nombreCampo("precio")}
            name={nombreCampo("precio")}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className={errores[nombreCampo("precio")] ? claseCampoMalo : claseCampo}
          />
          {/* Se muestra la cifra ya formateada mientras se escribe: es la única
              forma de que nadie guarde 6.000 creyendo que puso 60.000. */}
          <p
            aria-live="polite"
            className={`cifra text-base ${
              lectura.valor ? "text-[var(--acento)]" : "text-[var(--texto-tenue)]"
            }`}
          >
            {lectura.valor ? formatearCOP(lectura.valor) : "—"}
            {lectura.valor !== null && lectura.valor !== variante.precioCop && (
              <span className="ml-2 text-xs font-medium text-[var(--texto-suave)]">
                antes {formatearCOP(variante.precioCop)}
              </span>
            )}
          </p>
          <ErrorCampo mensaje={errores[nombreCampo("precio")]} />
          {variante.precioAntesCop !== null && (
            <p className="text-xs text-[var(--texto-tenue)]">
              Precio tachado: {formatearCOP(variante.precioAntesCop)}. Si el precio
              nuevo lo alcanza, la oferta se retira al guardar.
            </p>
          )}
        </div>

        {/* --- Stock --- */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nombreCampo("stock")} className="text-sm font-medium">
            Stock
          </label>
          <div className="flex items-center gap-2">
            <input
              id={nombreCampo("stock")}
              name={nombreCampo("stock")}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className={`${
                errores[nombreCampo("stock")] ? claseCampoMalo : claseCampo
              } w-24 text-center`}
            />
            {/* Reponer es la operación más frecuente del día: los botones
                evitan seleccionar y reescribir el número cada vez. */}
            <div className="flex gap-1">
              <BotonStock etiqueta="Quitar uno" onClick={() => ajustarStock(-1)}>
                <Minus className="size-4" aria-hidden />
              </BotonStock>
              <BotonStock etiqueta="Agregar uno" onClick={() => ajustarStock(1)}>
                <Plus className="size-4" aria-hidden />
              </BotonStock>
              <BotonStock etiqueta="Agregar diez" onClick={() => ajustarStock(10)}>
                <span className="text-xs font-semibold">+10</span>
              </BotonStock>
            </div>
          </div>
          <ErrorCampo mensaje={errores[nombreCampo("stock")]} />
          {(analizarEntero(stock).valor ?? 0) === 0 && (
            <p className="text-xs text-[var(--peligro)]">
              En cero se muestra como agotado en la tienda.
            </p>
          )}
        </div>
      </div>

      {/* --- Activa --- */}
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          name={nombreCampo("activa")}
          defaultChecked={variante.activa}
          className="mt-0.5 size-4 accent-[var(--acento)]"
        />
        <span>
          <span className="font-medium">Variante a la venta</span>
          <span className="block text-xs text-[var(--texto-tenue)]">
            Desactivarla la esconde de la ficha sin borrarla ni tocar los pedidos
            que ya la compraron.
          </span>
        </span>
      </label>
    </div>
  );
}

function BotonStock({
  etiqueta,
  onClick,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="flex size-9 items-center justify-center rounded-full border bg-[var(--fondo-elevado)] transition-colors hover:bg-[var(--peligro-fondo)] hover:text-[var(--acento)]"
    >
      {children}
    </button>
  );
}

// ============================================================================
// Campos
// ============================================================================

/**
 * Todo lo editable vive aquí y no en el formulario de afuera por una razón de
 * ciclo de vida: la página le pone `key` a este bloque con la versión de los
 * datos. Cuando el guardado sale bien la versión cambia, React lo vuelve a
 * montar y los campos quedan mostrando lo que de verdad hay en la base —
 * incluidos los `version` ocultos, que si no se quedarían viejos y el segundo
 * guardado seguido fallaría con un conflicto falso.
 *
 * Cuando el guardado FALLA la versión no cambia, no se remonta nada, y lo que
 * la persona escribió sigue en pantalla.
 */
function Campos({
  producto,
  categorias,
  estado,
}: Props & { estado: EstadoFormularioProducto | undefined }) {
  const errores = estado?.errores ?? {};

  return (
    <div className="space-y-6">
      <input type="hidden" name="id" value={producto.id} />
      <input type="hidden" name="version" value={producto.version} />
      <input
        type="hidden"
        name="varianteIds"
        value={producto.variantes.map((v) => v.id).join(",")}
      />

      {/* ================= Lo básico ================= */}
      <Seccion titulo="Lo básico">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            type="text"
            defaultValue={producto.nombre}
            required
            className={errores.nombre ? claseCampoMalo : claseCampo}
          />
          <ErrorCampo mensaje={errores.nombre} />
        </div>

        {/* --- Slug: no se edita --- */}
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Lock className="size-3.5 text-[var(--texto-tenue)]" aria-hidden />
            Dirección web
          </span>
          <p className="rounded-xl border border-dashed bg-[var(--fondo-hondo)] px-4 py-2.5 font-mono text-sm text-[var(--texto-suave)]">
            {producto.rutaPublica}
          </p>
          <p className="text-xs text-[var(--texto-tenue)]">
            La dirección web no se cambia desde aquí: cambiarla sin una
            redirección 301 perdería el posicionamiento. Si hay que cambiarla,
            se hace junto con su redirección.
          </p>
          <Link
            href={producto.rutaPublica}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[var(--acento)] hover:underline"
          >
            Ver la ficha pública
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="categoriaId" className="text-sm font-medium">
              Categoría
            </label>
            <select
              id="categoriaId"
              name="categoriaId"
              defaultValue={producto.categoriaId ?? ""}
              className={errores.categoriaId ? claseCampoMalo : claseCampo}
            >
              <option value="">Sin categoría</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--texto-tenue)]">
              Cambiarla cambia la dirección pública del producto.
            </p>
            <ErrorCampo mensaje={errores.categoriaId} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="posicion" className="text-sm font-medium">
              Posición en el listado
            </label>
            <input
              id="posicion"
              name="posicion"
              type="text"
              inputMode="numeric"
              defaultValue={String(producto.posicion)}
              className={errores.posicion ? claseCampoMalo : claseCampo}
            />
            <p className="text-xs text-[var(--texto-tenue)]">
              El número más bajo sale primero.
            </p>
            <ErrorCampo mensaje={errores.posicion} />
          </div>
        </div>

        {/* --- Estado --- */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Estado</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ESTADOS_PRODUCTO.map((e) => (
              <label
                key={e.valor}
                className="flex cursor-pointer gap-2.5 rounded-xl border p-3 transition-colors hover:bg-[var(--fondo-hondo)] has-[:checked]:border-[var(--acento)] has-[:checked]:bg-[var(--peligro-fondo)]"
              >
                <input
                  type="radio"
                  name="estado"
                  value={e.valor}
                  defaultChecked={producto.estado === e.valor}
                  className="mt-0.5 size-4 accent-[var(--acento)]"
                />
                <span>
                  <span className="block text-sm font-medium">{e.etiqueta}</span>
                  <span className="block text-xs text-[var(--texto-tenue)]">
                    {e.ayuda}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <ErrorCampo mensaje={errores.estado} />
        </fieldset>

        {/* --- Destacado --- */}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-[var(--fondo-hondo)] has-[:checked]:border-[var(--acento)] has-[:checked]:bg-[var(--peligro-fondo)]">
          <input
            type="checkbox"
            name="destacado"
            defaultChecked={producto.destacado}
            className="mt-0.5 size-4 accent-[var(--acento)]"
          />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Star className="size-4 text-[var(--acento)]" aria-hidden />
              Mostrar en la portada
            </span>
            {/* Mientras no haya ninguno marcado, la portada reparte una
                selección automática entre categorías. El primero que se marque
                apaga ese reparto: desde ahí manda esta casilla. */}
            <span className="block text-xs text-[var(--texto-tenue)]">
              Aparece en la sección de destacados de la portada.
            </span>
          </span>
        </label>
      </Seccion>

      {/* ================= Variantes ================= */}
      <Seccion
        titulo={producto.variantes.length === 1 ? "Precio y stock" : "Variantes"}
        ayuda="El precio y el stock viven en la variante, nunca en el producto. Un producto simple es un producto con una sola variante."
      >
        {producto.variantes.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-[var(--texto-suave)]">
            Este producto no tiene ninguna variante, así que no se puede vender.
            Hay que crearle una desde la base de datos.
          </p>
        ) : (
          <div className="space-y-4">
            {producto.variantes.map((v) => (
              <FilaVariante key={v.id} variante={v} errores={errores} />
            ))}
          </div>
        )}
      </Seccion>

      {/* ================= Descripción ================= */}
      <Seccion
        titulo="Descripción"
        ayuda="El texto plano alimenta el buscador y la descripción que ve Google cuando no hay una escrita a mano."
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="descripcion" className="text-sm font-medium">
            Texto plano
          </label>
          <textarea
            id="descripcion"
            name="descripcion"
            rows={4}
            defaultValue={producto.descripcion ?? ""}
            className={errores.descripcion ? claseCampoMalo : claseCampo}
          />
          <ErrorCampo mensaje={errores.descripcion} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="descripcionHtml" className="text-sm font-medium">
            Con formato (HTML)
          </label>
          <p className="text-xs text-[var(--texto-tenue)]">
            Es lo que se pinta en la ficha. Evita colores fijos en los estilos:
            se ven mal en modo oscuro. Al guardar se quitan los scripts y demás
            código ejecutable.
          </p>
          <textarea
            id="descripcionHtml"
            name="descripcionHtml"
            rows={8}
            defaultValue={producto.descripcionHtml ?? ""}
            className={`${
              errores.descripcionHtml ? claseCampoMalo : claseCampo
            } font-mono text-xs`}
          />
          <ErrorCampo mensaje={errores.descripcionHtml} />
        </div>
      </Seccion>

      {/* ================= SEO ================= */}
      <Seccion
        titulo="Buscadores"
        ayuda="Si los dejas vacíos se usa el nombre del producto y una descripción armada con su precio."
      >
        <CampoContado
          id="seoTitulo"
          nombre="seoTitulo"
          etiqueta="Título en Google"
          recomendado={60}
          inicial={producto.seoTitulo ?? ""}
          error={errores.seoTitulo}
        />
        <CampoContado
          id="seoDescripcion"
          nombre="seoDescripcion"
          etiqueta="Descripción en Google"
          ayuda="Google corta alrededor de los 155 caracteres."
          recomendado={155}
          inicial={producto.seoDescripcion ?? ""}
          filas={3}
          error={errores.seoDescripcion}
        />
      </Seccion>
    </div>
  );
}

// ============================================================================
// Formulario
// ============================================================================

function BarraGuardar({ producto }: { producto: FichaProductoAdmin }) {
  const { pending } = useFormStatus();

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t bg-[var(--fondo-elevado)]/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--texto-tenue)]">
          Última modificación: {formatearFecha(producto.actualizado)}
        </p>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/productos/"
            className="rounded-full border px-5 py-2.5 text-sm transition-colors hover:bg-[var(--fondo-hondo)]"
          >
            Volver
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-2.5 text-sm font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Guardando…
              </>
            ) : (
              "Guardar cambios"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Zona de peligro: retirar el producto del catálogo.
 *
 * Va en un <form> HERMANO, no dentro del de edición: los formularios no se
 * anidan en HTML, y un botón dentro del otro form dispararía `guardarProducto`
 * en vez de este.
 *
 * Dos frenos antes de un acto sin deshacer: hay que abrir la sección a
 * propósito y escribir el nombre del producto. El servidor vuelve a comprobar
 * ese nombre —el freno de aquí es comodidad, no seguridad—.
 */
function ZonaPeligro({ producto }: { producto: FichaProductoAdmin }) {
  const [abierta, setAbierta] = useState(false);
  const [escrito, setEscrito] = useState("");
  const [estado, accion] = useActionState<EstadoFormularioProducto | undefined, FormData>(
    eliminarProducto,
    undefined,
  );

  const coincide = escrito.trim().toLowerCase() === producto.nombre.trim().toLowerCase();

  if (estado?.eliminado) {
    return (
      <div
        role="status"
        className="mt-10 flex flex-wrap items-center gap-4 rounded-[var(--radius-tarjeta)] bg-[var(--exito)]/15 px-5 py-4 text-sm text-[var(--disponible)]"
      >
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        <p className="flex-1 font-medium">{estado.mensaje}</p>
        <Link
          href="/admin/productos/"
          className="rounded-full border px-4 py-1.5 text-xs font-medium text-[var(--texto)] transition-colors hover:bg-[var(--fondo-elevado)]"
        >
          Volver a productos
        </Link>
      </div>
    );
  }

  return (
    <form
      action={accion}
      className="mt-10 rounded-[var(--radius-tarjeta)] border border-[var(--peligro-borde)] bg-[var(--peligro-fondo)] p-5 sm:p-6"
    >
      <input type="hidden" name="id" value={producto.id} />

      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--peligro)]">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        Retirar del catálogo
      </h2>

      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--peligro)]/85">
        Si el producto tiene ventas, se archiva y su dirección redirige a la
        categoría. Si nunca se vendió, se elimina.
      </p>

      {estado?.error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-background/70 px-4 py-3 text-sm text-[var(--peligro)]"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {estado.error}
        </p>
      )}

      {!abierta ? (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--peligro)]/30 px-5 py-2 text-sm font-medium text-[var(--peligro)] transition-colors hover:bg-muted"
        >
          <Trash2 className="size-4" aria-hidden />
          Retirar este producto
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <label
            htmlFor="confirmacion"
            className="block text-sm font-medium text-[var(--peligro)]"
          >
            Escribe <strong>{producto.nombre}</strong> para confirmar
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="confirmacion"
              name="confirmacion"
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-w-64 flex-1 rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none focus:border-[var(--acento)]"
            />
            <BotonRetirar habilitado={coincide} />
            <button
              type="button"
              onClick={() => {
                setAbierta(false);
                setEscrito("");
              }}
              className="rounded-full px-4 py-2 text-sm text-[var(--peligro)] underline-offset-4 hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function BotonRetirar({ habilitado }: { habilitado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={!habilitado || pending}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--peligro)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Retirando…
        </>
      ) : (
        <>
          <Trash2 className="size-4" aria-hidden />
          Retirar
        </>
      )}
    </button>
  );
}

export function FormularioProducto({ producto, categorias, esAdmin }: Props) {
  const router = useRouter();
  const [estado, accion] = useActionState<EstadoFormularioProducto | undefined, FormData>(
    guardarProducto,
    undefined,
  );

  /**
   * El banner de resultado vive arriba del formulario y el botón Guardar
   * abajo: tras un fallo de validación la persona veía que "no pasó nada".
   * Al llegar un resultado nuevo se lleva la vista hasta él.
   */
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (estado) bannerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [estado]);

  // Firma de la versión de TODO lo editable. Cambia solo cuando la base
  // cambió, que es exactamente cuando los campos deben volver a montarse.
  const firma = `${producto.version}:${producto.variantes.map((v) => v.version).join(",")}`;

  return (
    <>
    <form action={accion}>
      <div ref={bannerRef} />
      {estado?.error && (
        <div
          role="alert"
          className={`mb-6 flex items-start gap-3 rounded-[var(--radius-tarjeta)] px-5 py-4 text-sm ${
            estado.conflicto
              ? "bg-[var(--aviso)]/15 text-[var(--texto)]"
              : "bg-[var(--peligro-fondo)] text-[var(--peligro)]"
          }`}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="space-y-2">
            <p>{estado.error}</p>
            {estado.conflicto && (
              <button
                type="button"
                onClick={() => router.refresh()}
                className="inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--fondo-elevado)]"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Recargar la ficha
              </button>
            )}
          </div>
        </div>
      )}

      {estado?.ok && estado.mensaje && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-[var(--radius-tarjeta)] bg-[var(--exito)]/15 px-5 py-4 text-sm text-[var(--disponible)]"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="font-medium">{estado.mensaje}</p>
        </div>
      )}

      {estado?.avisos && estado.avisos.length > 0 && (
        <div className="mb-6 space-y-2 rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)] px-5 py-4 text-sm">
          {estado.avisos.map((aviso) => (
            <p key={aviso} className="flex items-start gap-2 text-[var(--texto-suave)]">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {aviso}
            </p>
          ))}
        </div>
      )}

      <Campos
        key={firma}
        producto={producto}
        categorias={categorias}
        estado={estado}
        esAdmin={esAdmin}
      />

      <BarraGuardar producto={producto} />
    </form>

    {esAdmin && <ZonaPeligro producto={producto} />}
    </>
  );
}
