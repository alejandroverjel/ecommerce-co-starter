"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { AlertCircle, ArrowRight, Check, Loader2, ShoppingBag, Tag, X } from "lucide-react";

import { calcularEnvio, faltaParaEnvioGratis, type ConfigTienda } from "@/lib/envio";
import { calcularSubtotal, useCarrito } from "@/lib/stores/carrito";
import { formatearCOP } from "@/lib/formato";
import { previsualizarCupon } from "@/lib/pedido/cupon";
import { trackearIniciarCheckout } from "@/lib/analitica/eventos";
import {
  FRANJAS,
  franjaSigueAbierta,
  primeraFechaConFranja,
  primeraFranjaAbierta,
  MAX_MENSAJE,
  METODOS_PAGO,
  MUNICIPIOS,
  esquemaPedido,
  fechaMaxima,
  hoyEnBogota,
  type DatosPedido,
} from "@/lib/validaciones/pedido";
import { useMontado } from "@/lib/hooks/usar-montado";
import { CONTACTO, enlaceWhatsapp, hayWhatsapp } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";

function Error({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className="text-xs text-[var(--peligro)]">
      {mensaje}
    </p>
  );
}

function Campo({
  etiqueta,
  htmlFor,
  ayuda,
  error,
  children,
  className = "",
}: {
  etiqueta: string;
  htmlFor: string;
  ayuda?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {etiqueta}
      </label>
      {ayuda && <p className="text-xs text-[var(--texto-tenue)]">{ayuda}</p>}
      {children}
      <Error mensaje={error} />
    </div>
  );
}

const claseCampo =
  "w-full rounded-xl border bg-[var(--fondo-elevado)] px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]";

/**
 * "Continuar" de los pasos 1 y 2.
 *
 * `type="button"`: dentro de un <form> el botón por defecto envía, y aquí
 * enviar a mitad del checkout crearía el pedido sin los datos de entrega.
 */
function BotonPaso({
  onClick,
  className = "flex",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3.5 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] ${className}`}
    >
      Continuar
      <ArrowRight className="size-4" aria-hidden />
    </button>
  );
}

export function FormularioPedido({
  config,
  pasarelas,
}: {
  config: ConfigTienda;
  /** Pasarelas encendidas en el panel. Contra entrega no es pasarela. */
  pasarelas: string[];
}) {
  /**
   * Solo se ofrece lo que de verdad puede cobrar.
   *
   * Solo las pasarelas que el panel tiene encendidas y con llaves: ofrecer un
   * método apagado lleva al cliente hasta el último paso para fallar ahí.
   *
   * Ya no hay caso especial para contra entrega: el negocio la retiró al
   * activar el pago en línea. Si NINGUNA pasarela quedara disponible, el
   * formulario no deja pagar y ofrece WhatsApp, en vez de aceptar un pedido que
   * nadie podría cobrar.
   */
  const metodos = METODOS_PAGO.filter((m) => pasarelas.includes(m.valor));
  const router = useRouter();
  const lineas = useCarrito((e) => e.lineas);
  const vaciar = useCarrito((e) => e.vaciar);

  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<DatosPedido>({
    resolver: standardSchemaResolver(esquemaPedido),
    defaultValues: {
      municipio: MUNICIPIOS[0],
      metodoPago: metodos[0]?.valor as DatosPedido["metodoPago"],
      // Se abre en el primer día con franja disponible: a partir de las 7 p.m.
      // hoy ya no admite ninguna, y arrancar ahí dejaba las tres en gris sin
      // decir que la salida era cambiar la fecha.
      fechaEntrega: primeraFechaConFranja(),
      franja: primeraFranjaAbierta(primeraFechaConFranja()) ?? FRANJAS[0].valor,
    },
  });

  const montado = useMontado();

  const mensaje = watch("mensajeTarjeta") ?? "";

  /**
   * Recuperación de carrito: marcada por defecto, como el resto del comercio
   * serio. Es una casilla real —se puede desmarcar— y sin ella no se guarda
   * nada (el endpoint exige consent === true).
   */
  const [autorizaCorreos, setAutorizaCorreos] = useState(true);

  /** Hora puntual pedida por el cliente; viaja dentro de las indicaciones. */
  const [horaEspecifica, setHoraEspecifica] = useState("");

  /**
   * Cupón. Se previsualiza contra el servidor para mostrar el descuento antes
   * de pagar, pero el monto real lo fija `create_pending_order`: aquí solo se
   * guarda el código validado, que viaja en el payload.
   */
  const [cuponInput, setCuponInput] = useState("");
  const [cupon, setCupon] = useState<
    Extract<Awaited<ReturnType<typeof previsualizarCupon>>, { ok: true }> | null
  >(null);
  const [cargandoCupon, setCargandoCupon] = useState(false);
  const [errorCupon, setErrorCupon] = useState<string | null>(null);

  /**
   * Tres pasos: correo, entrega, pago.
   *
   * Antes eran seis bloques seguidos en una sola pantalla y no había forma de
   * saber cuánto faltaba. Los bloques de otros pasos se OCULTAN con CSS en vez
   * de desmontarse: así conservan su valor y su registro, y el envío final
   * valida el formulario entero de una vez.
   */
  const [paso, setPaso] = useState(1);

  const CAMPOS_DEL_PASO: Record<number, (keyof DatosPedido)[]> = {
    1: ["compradorCorreo"],
    2: [
      "destinatarioNombre",
      "destinatarioTelefono",
      "municipio",
      "direccion",
      "indicaciones",
      "fechaEntrega",
      "franja",
      "mensajeTarjeta",
    ],
    3: ["compradorNombre", "compradorTelefono", "metodoPago"],
  };

  /** Avanza solo si lo que ya se llenó es válido. */
  async function avanzar() {
    const valido = await trigger(CAMPOS_DEL_PASO[paso]);
    if (!valido) return;

    // Al salir del paso del correo se guarda el carrito: es justo aquí donde
    // se puede perder a alguien y ya tenemos con qué escribirle.
    if (paso === 1) void guardarParaRecuperar();

    setPaso((p) => p + 1);
    // Sin esto la pantalla se queda a media altura del paso anterior.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function retroceder(destino: number) {
    if (destino >= paso) return;
    setPaso(destino);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const PASOS = [
    { n: 1, nombre: "Correo" },
    { n: 2, nombre: "Entrega" },
    { n: 3, nombre: "Pago" },
  ];

  /**
   * Guarda el correo y el carrito al salir del campo, no al enviar: quien
   * abandona nunca llega a enviar. Es fuego y olvido — si falla, la compra
   * sigue igual y lo único que se pierde es el recordatorio.
   */
  async function guardarParaRecuperar() {
    const correo = (watch("compradorCorreo") ?? "").trim();
    // Validación mínima antes de mandar nada: el campo se pierde el foco
    // también a medio escribir.
    if (!autorizaCorreos || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return;
    if (lineas.length === 0) return;

    try {
      await fetch("/api/carrito-abandonado/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          email: correo,
          consent: true,
          subtotalCop: calcularSubtotal(lineas),
          items: lineas.map((l) => ({
            productoId: l.productoId,
            varianteId: l.varianteId,
            slug: l.slug,
            nombre: l.nombre,
            precioCop: l.precioCop,
            imagenUrl: l.imagenUrl,
            ruta: l.ruta,
            cantidad: l.cantidad,
          })),
        }),
      });
    } catch {
      // Sin red no pasa nada: es un extra, no parte de la compra.
    }
  }

  // El método elegido cambia el botón: con pasarela (Mercado Pago / Wompi) se
  // sale del sitio a pagar, así que el botón lo dice en vez de "Confirmar
  // pedido" a secas, para que la redirección no sorprenda.
  const metodoSel = watch("metodoPago");
  const nombrePasarela =
    METODOS_PAGO.find((m) => m.valor === metodoSel)?.nombre ?? null;

  // La fecha decide qué franjas siguen abiertas; la franja elegida marca su
  // tarjeta. Ambas se observan para que el bloque reaccione al cambiar la fecha.
  const fechaElegida = watch("fechaEntrega") ?? hoyEnBogota();
  const franjaSel = watch("franja");

  async function enviar(datos: DatosPedido) {
    setErrorServidor(null);

    // Intención de compra: se envió el formulario de pedido. La conversión de
    // compra confirmada va aparte, en la página de gracias (purchase).
    trackearIniciarCheckout(
      total,
      lineas.map((l) => ({
        id: l.productoId,
        nombre: l.nombre,
        precioCop: l.precioCop,
        cantidad: l.cantidad,
      })),
    );

    // La barra final es obligatoria: `trailingSlash: true` también aplica a
    // las rutas de API, y sin ella el POST recibe un 308 antes de llegar.
    let respuesta: Response;
    try {
      respuesta = await fetch("/api/checkout/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...datos,
          /**
           * La hora pedida encabeza las indicaciones: es lo primero que tiene
           * que ver quien arma la ruta. Se recorta al tope que acepta el
           * servidor para que añadirla nunca haga fallar el pedido.
           */
          indicaciones: (horaEspecifica.trim()
            ? `Entregar a las ${horaEspecifica.trim()}. ${datos.indicaciones ?? ""}`
            : (datos.indicaciones ?? "")
          )
            .trim()
            .slice(0, 300),
          // El código va validado; el descuento real lo recalcula el servidor.
          cupon: cupon?.codigo,
          // Solo qué y cuánto. Los precios los relee el servidor de la base:
          // editar localStorage no puede abaratar un pedido.
          lineas: lineas.map((l) => ({
            productoId: l.productoId,
            varianteId: l.varianteId,
            cantidad: l.cantidad,
          })),
        }),
      });
    } catch {
      // Sin red / servidor inalcanzable: fetch lanza. Sin este catch la
      // excepción subía sin decirle nada al comprador y el botón quedaba
      // "cargando" para siempre.
      setErrorServidor(
        "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.",
      );
      return;
    }

    const cuerpo = await respuesta.json().catch(() => null);

    if (!respuesta.ok) {
      setErrorServidor(cuerpo?.error ?? "No pudimos crear el pedido. Intenta de nuevo.");
      return;
    }

    /**
     * 200 con cuerpo ilegible (un proxy que recorta la respuesta): el pedido
     * puede existir, pero sin número no hay a dónde redirigir. Antes esto
     * seguía derecho, vaciaba el carrito y reventaba con TypeError al leer
     * `cuerpo.numeroPedido` — la peor combinación: carrito perdido y pantalla
     * rota. Se avisa y NO se vacía nada.
     */
    if (!cuerpo?.numeroPedido) {
      setErrorServidor(
        "Recibimos una respuesta incompleta. Si te llega el correo de confirmación, tu pedido quedó creado: no lo repitas. Si no, inténtalo de nuevo.",
      );
      return;
    }

    // El carrito se vacía solo cuando el pedido ya existe en la base. Si se
    // vaciara antes y algo fallara, el cliente perdería su selección.
    vaciar();

    // Wompi devuelve la URL del checkout hospedado: el cobro ocurre allá. Se
    // usa una navegación completa del navegador, no el router, porque es un
    // dominio externo. Al volver, Wompi redirige a la página de gracias.
    if (cuerpo?.urlPago) {
      window.location.assign(cuerpo.urlPago);
      return;
    }

    // El total y su firma viajan en la URL: la página de gracias los verifica
    // y pinta la cifra real, sin tener que consultar la base con un número de
    // pedido que cualquiera podría adivinar.
    const params = new URLSearchParams({ pedido: String(cuerpo.numeroPedido) });
    if (cuerpo?.totalCop != null && cuerpo?.firma) {
      params.set("total", String(cuerpo.totalCop));
      params.set("firma", String(cuerpo.firma));
    }
    router.push(`/finalizar-compra/gracias/?${params}`);
  }

  if (!montado) {
    return <div className="h-96 animate-pulse rounded-[var(--radius-tarjeta)] bg-[var(--fondo-hondo)]" />;
  }

  if (lineas.length === 0) {
    return (
      <div className="tarjeta mx-auto max-w-md p-10 text-center">
        <ShoppingBag className="mx-auto size-8 text-[var(--texto-tenue)]" aria-hidden />
        <p className="display mt-4 text-2xl">Tu carrito está vacío</p>
        <p className="mt-3 text-sm text-[var(--texto-suave)]">
          Agrega productos antes de continuar.
        </p>
        <Link
          href="/tienda/"
          className="mt-6 inline-block rounded-full bg-[var(--acento)] px-6 py-3 text-sm font-medium text-[var(--acento-texto)]"
        >
          Ver la tienda
        </Link>
      </div>
    );
  }

  const subtotal = calcularSubtotal(lineas);

  // El descuento del cupón se resta del subtotal, y el envío se recalcula sobre
  // lo que queda —igual que create_pending_order en la base—, así el número
  // mostrado coincide con el que se cobra. La cifra sigue siendo estimada: el
  // total autoritativo lo fija el servidor al crear el pedido.
  const descuento = cupon?.descuentoCop ?? 0;
  const subtotalNeto = Math.max(0, subtotal - descuento);
  const envio = cupon?.envioGratis ? 0 : calcularEnvio(subtotalNeto, config);
  const total = subtotalNeto + envio;
  const falta = cupon ? null : faltaParaEnvioGratis(subtotal, config);

  async function aplicarCupon() {
    const codigo = cuponInput.trim();
    if (!codigo || cargandoCupon) return;
    setCargandoCupon(true);
    setErrorCupon(null);
    try {
      const r = await previsualizarCupon(codigo, subtotal);
      if (r.ok) {
        setCupon(r);
        setErrorCupon(null);
      } else {
        setCupon(null);
        setErrorCupon(r.error);
      }
    } catch {
      setErrorCupon("No pudimos validar el cupón. Intenta de nuevo.");
    } finally {
      setCargandoCupon(false);
    }
  }

  function quitarCupon() {
    setCupon(null);
    setCuponInput("");
    setErrorCupon(null);
  }

  return (
    <form
      onSubmit={handleSubmit(enviar)}
      noValidate
      className="mt-8 grid gap-8 pb-40 lg:grid-cols-[1fr_21rem] lg:gap-12 lg:pb-0"
    >
      <div className="space-y-6">
        {/* ------------------------------------------------------------------
            Indicador de pasos. Un paso ya recorrido se puede tocar para
            volver; los de adelante no, porque todavía no se han validado.
            ------------------------------------------------------------------ */}
        <ol className="flex items-center gap-2" aria-label="Progreso del checkout">
          {PASOS.map((p, i) => {
            const hecho = p.n < paso;
            const actual = p.n === paso;
            return (
              <li key={p.n} className="flex flex-1 items-center gap-2 last:flex-none">
                <button
                  type="button"
                  onClick={() => retroceder(p.n)}
                  disabled={!hecho}
                  aria-current={actual ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-full ${
                    hecho ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      hecho
                        ? "bg-[var(--disponible)] text-white"
                        : actual
                          ? "bg-[var(--acento)] text-[var(--acento-texto)]"
                          : "border border-[var(--borde)] text-[var(--texto-tenue)]"
                    }`}
                  >
                    {hecho ? <Check className="size-3.5" aria-hidden /> : p.n}
                  </span>
                  <span
                    className={`text-sm ${
                      actual ? "font-medium" : "text-[var(--texto-suave)]"
                    } ${p.n === 2 ? "hidden sm:inline" : ""}`}
                  >
                    {p.nombre}
                  </span>
                </button>
                {i < PASOS.length - 1 && (
                  <span
                    aria-hidden
                    className={`h-px flex-1 ${
                      hecho ? "bg-[var(--disponible)]" : "bg-[var(--borde)]"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* ============================ PASO 1 ============================
            El correo va PRIMERO y solo. Es el dato que permite retomar el
            contacto si la compra se queda a medias: pedirlo al final significa
            no tenerlo justo de quien abandona. Se guarda al pasar de paso
            (ver `guardarParaRecuperar`), no al enviar el formulario.
            ================================================================ */}
        <div className={paso === 1 ? "space-y-6" : "hidden"}>
        <fieldset className="tarjeta p-6">
          <legend className="solo-lectores">Tu correo</legend>
          <p className="display mb-5 text-xl">Tu correo</p>
          <p className="-mt-3 mb-4 text-sm text-[var(--texto-suave)]">
            Ahí te llega la confirmación del pedido y el aviso cuando salga a
            entrega.
          </p>

          <Campo
            etiqueta="Correo electrónico"
            htmlFor="compradorCorreo"
            error={errors.compradorCorreo?.message}
          >
            <input
              id="compradorCorreo"
              type="email"
              autoComplete="email"
              inputMode="email"
              className={claseCampo}
              {...register("compradorCorreo", { onBlur: guardarParaRecuperar })}
            />
          </Campo>

          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-[var(--texto-suave)]">
            <input
              type="checkbox"
              checked={autorizaCorreos}
              onChange={(e) => setAutorizaCorreos(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--acento)]"
            />
            <span>
              Autorizo que me escriban si dejo la compra a medias, para poder
              retomarla. Puedo darme de baja cuando quiera.
            </span>
          </label>
        </fieldset>

        <BotonPaso onClick={avanzar} className="hidden lg:flex" />
        </div>

        {/* ============================ PASO 2 ============================ */}
        <div className={paso === 2 ? "space-y-6" : "hidden"}>
        <fieldset className="tarjeta p-6">
          <legend className="solo-lectores">
            {TIENDA.checkout.destinatarioDistinto ? "Para quién es" : "Datos de entrega"}
          </legend>
          <p className="display mb-5 text-xl">
            {TIENDA.checkout.destinatarioDistinto ? "Para quién es" : "Datos de entrega"}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {TIENDA.checkout.destinatarioDistinto && (
              <>
                <Campo
                  etiqueta="Nombre de quien recibe"
                  htmlFor="destinatarioNombre"
                  error={errors.destinatarioNombre?.message}
                >
                  <input
                    id="destinatarioNombre"
                    autoComplete="off"
                    className={claseCampo}
                    {...register("destinatarioNombre")}
                  />
                </Campo>

                <Campo
                  etiqueta="Su teléfono"
                  htmlFor="destinatarioTelefono"
                  ayuda="El mensajero llama a este número al llegar"
                  error={errors.destinatarioTelefono?.message}
                >
                  <input
                    id="destinatarioTelefono"
                    type="tel"
                    inputMode="tel"
                    placeholder="300 000 0000"
                    className={claseCampo}
                    {...register("destinatarioTelefono")}
                  />
                </Campo>
              </>
            )}

            <Campo
              etiqueta="Municipio"
              htmlFor="municipio"
              error={errors.municipio?.message}
            >
              <select id="municipio" className={claseCampo} {...register("municipio")}>
                {MUNICIPIOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              etiqueta="Dirección"
              htmlFor="direccion"
              error={errors.direccion?.message}
              className="sm:col-span-2"
            >
              <input
                id="direccion"
                autoComplete="street-address"
                placeholder="Calle 10 #43-25, apto 502"
                className={claseCampo}
                {...register("direccion")}
              />
            </Campo>

            {/*
              Hora específica: no es un campo de la base, se antepone a las
              indicaciones al enviar. Así el mensajero la ve en el mismo sitio
              donde ya mira todo lo de la entrega, sin partir el dato en dos.
              La franja (mañana/tarde/noche) sigue mandando; esto la afina.
              Solo se ofrece si la tienda lo permite (checkout.permitirHora).
            */}
            {TIENDA.entregas.permitirHora && (
              <Campo
                etiqueta="¿Necesitas una hora específica?"
                htmlFor="horaEspecifica"
                ayuda="Opcional. Ej: 3:00 p. m. Hacemos lo posible dentro de la franja elegida."
                className="sm:col-span-2"
              >
                <input
                  id="horaEspecifica"
                  type="text"
                  inputMode="text"
                  maxLength={40}
                  placeholder="Ej: 3:00 p. m."
                  value={horaEspecifica}
                  onChange={(e) => setHoraEspecifica(e.target.value)}
                  className={claseCampo}
                />
              </Campo>
            )}

            <Campo
              etiqueta="Indicaciones para el mensajero"
              htmlFor="indicaciones"
              ayuda="Opcional. Portería, torre, algún punto de referencia."
              error={errors.indicaciones?.message}
              className="sm:col-span-2"
            >
              <textarea
                id="indicaciones"
                rows={2}
                className={claseCampo}
                {...register("indicaciones")}
              />
            </Campo>
          </div>
        </fieldset>

        {/* ------------------------------------------------------------------ */}
        <fieldset className="tarjeta p-6">
          <legend className="solo-lectores">Cuándo la entregamos</legend>
          <p className="display mb-5 text-xl">Cuándo la entregamos</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Fecha de entrega"
              htmlFor="fechaEntrega"
              error={errors.fechaEntrega?.message}
            >
              <input
                id="fechaEntrega"
                type="date"
                min={hoyEnBogota()}
                max={fechaMaxima()}
                className={claseCampo}
                {...register("fechaEntrega")}
              />
            </Campo>

            {/* La franja va en tarjetas, no en un <select>: es una decisión
                que conviene ver de golpe, con cuál sigue abierta. Antes se
                podía escoger una ya cerrada y el servidor la rechazaba al
                enviar, con todo el formulario lleno. */}
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Franja</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {FRANJAS.map((f) => {
                  const cerrada = !franjaSigueAbierta(f.valor, fechaElegida);
                  const [nombre, horario] = f.etiqueta.split(" (");
                  return (
                    <label
                      key={f.valor}
                      className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                        cerrada
                          ? "cursor-not-allowed opacity-55"
                          : "cursor-pointer hover:bg-[var(--fondo-hondo)]"
                      } ${
                        franjaSel === f.valor && !cerrada
                          ? "border-[var(--acento)] bg-primary/5"
                          : ""
                      }`}
                    >
                      <input
                        type="radio"
                        value={f.valor}
                        disabled={cerrada}
                        className="size-4 shrink-0 accent-[var(--acento)]"
                        {...register("franja")}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{nombre}</span>
                        <span className="block text-xs text-[var(--texto-suave)]">
                          {cerrada
                            ? "Ya cerró para hoy · pide para mañana"
                            : horario?.replace(")", "")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {/* Si escoge un día sin franjas (hoy, ya de noche), la salida
                  se dice en palabras en vez de dejar tres casillas muertas. */}
              {FRANJAS.every((f) => !franjaSigueAbierta(f.valor, fechaElegida)) && (
                <p className="mt-2 rounded-xl bg-[var(--fondo-hondo)] px-4 py-3 text-xs leading-relaxed text-[var(--texto-suave)]">
                  Para hoy ya cerramos todas las franjas. Escoge otra fecha y
                  vuelven a habilitarse.
                </p>
              )}
              <Error mensaje={errors.franja?.message} />
            </fieldset>
          </div>
        </fieldset>

        {/* El mensaje de regalo solo se ofrece si la tienda lo activa
            (checkout.mensajeRegalo en tienda.config.ts). */}
        {TIENDA.checkout.mensajeRegalo && (
          <fieldset className="tarjeta p-6">
            <legend className="solo-lectores">Mensaje de regalo (opcional)</legend>
            <p className="display mb-5 text-xl">Mensaje de regalo (opcional)</p>

            <p className="mt-2 text-sm leading-relaxed text-[var(--texto-suave)]">
              La escribimos a mano y va con el pedido. Sin costo.
            </p>

            <div className="mt-4">
              <label htmlFor="mensajeTarjeta" className="solo-lectores">
                Mensaje de la tarjeta
              </label>
              <textarea
                id="mensajeTarjeta"
                rows={4}
                maxLength={MAX_MENSAJE}
                placeholder="Feliz cumpleaños. Te deseo lo mejor."
                className={`${claseCampo} display text-lg leading-relaxed`}
                {...register("mensajeTarjeta")}
              />
              <div className="mt-1.5 flex items-baseline justify-between">
                <Error mensaje={errors.mensajeTarjeta?.message} />
                <span
                  className={`ml-auto text-xs tabular-nums ${
                    mensaje.length > MAX_MENSAJE - 30
                      ? "text-[var(--peligro)]"
                      : "text-[var(--texto-tenue)]"
                  }`}
                >
                  {mensaje.length}/{MAX_MENSAJE}
                </span>
              </div>
            </div>
          </fieldset>
        )}

        <BotonPaso onClick={avanzar} className="hidden lg:flex" />
        </div>

        {/* ============================ PASO 3 ============================ */}
        <div className={paso === 3 ? "space-y-6" : "hidden"}>
        <fieldset className="tarjeta p-6">
          <legend className="solo-lectores">Tus datos</legend>
          <p className="display mb-5 text-xl">Tus datos</p>
          <p className="mt-2 text-sm text-[var(--texto-suave)]">
            Para enviarte la confirmación y avisarte cuando salga el pedido.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Tu nombre"
              htmlFor="compradorNombre"
              error={errors.compradorNombre?.message}
              className="sm:col-span-2"
            >
              <input
                id="compradorNombre"
                autoComplete="name"
                className={claseCampo}
                {...register("compradorNombre")}
              />
            </Campo>

            <Campo
              etiqueta="Tu teléfono"
              htmlFor="compradorTelefono"
              error={errors.compradorTelefono?.message}
            >
              <input
                id="compradorTelefono"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={claseCampo}
                {...register("compradorTelefono")}
              />
            </Campo>
          </div>
        </fieldset>

        {/* ------------------------------------------------------------------ */}
        <fieldset className="tarjeta p-6">
          <legend className="solo-lectores">Cómo pagas</legend>
          <p className="display mb-5 text-xl">Cómo pagas</p>

          {/*
            Sin contra entrega, si todas las pasarelas están apagadas no hay
            forma de cobrar: mejor decirlo y mandar a WhatsApp que aceptar un
            pedido que nadie va a poder pagar.
          */}
          {metodos.length === 0 && (
            <div className="rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]">
              <p className="font-medium">Los pagos en línea están en mantenimiento.</p>
              <p className="mt-1">
                {hayWhatsapp ? (
                  <>
                    Escríbenos por{" "}
                    <a href={enlaceWhatsapp() ?? undefined} className="underline">
                      WhatsApp
                    </a>{" "}
                    y te ayudamos a completar el pedido.
                  </>
                ) : (
                  <>
                    Escríbenos a {CONTACTO.correo} y te ayudamos a completar el
                    pedido.
                  </>
                )}
              </p>
            </div>
          )}

          <div className="mt-4 space-y-2.5">
            {metodos.map((m) => (
              <label
                key={m.valor}
                className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:checked]:border-[var(--acento)] has-[:checked]:bg-[var(--fondo-hondo)]"
              >
                <input
                  type="radio"
                  value={m.valor}
                  className="mt-0.5 accent-[var(--acento)]"
                  {...register("metodoPago")}
                />
                <span>
                  <span className="block text-sm font-medium">{m.etiqueta}</span>
                  <span className="block text-xs text-[var(--texto-tenue)]">{m.ayuda}</span>
                </span>
              </label>
            ))}
          </div>
          <Error mensaje={errors.metodoPago?.message} />
        </fieldset>
        </div>
      </div>

      {/* ==================================================================== */}
      <aside className="lg:sticky lg:top-32 lg:h-fit">
        <div className="tarjeta p-6">
          <h2 className="display text-xl">Tu pedido</h2>

          <ul className="mt-4 space-y-3">
            {lineas.map((l) => (
              <li
                key={`${l.productoId}-${l.varianteId ?? "unica"}`}
                className="flex items-center gap-3"
              >
                <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-[var(--fondo-hondo)]">
                  {l.imagenUrl && (
                    <Image src={l.imagenUrl} alt="" fill sizes="3rem" className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.nombre}</p>
                  <p className="text-xs text-[var(--texto-tenue)]">
                    {l.cantidad} × {formatearCOP(l.precioCop)}
                  </p>
                </div>
                <p className="cifra shrink-0 text-sm">
                  {formatearCOP(l.precioCop * l.cantidad)}
                </p>
              </li>
            ))}
          </ul>

          <dl className="mt-5 space-y-2.5 border-t pt-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--texto-suave)]">Productos</dt>
              <dd className="cifra">{formatearCOP(subtotal)}</dd>
            </div>
            {cupon && descuento > 0 && (
              <div className="flex justify-between text-[var(--disponible)]">
                <dt>Descuento ({cupon.codigo})</dt>
                <dd className="cifra">− {formatearCOP(descuento)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-[var(--texto-suave)]">Envío</dt>
              <dd className={envio === 0 ? "font-medium text-[var(--disponible)]" : "cifra"}>
                {envio === 0 ? "Gratis" : formatearCOP(envio)}
              </dd>
            </div>
          </dl>

          {/* Cupón. La validación es del servidor; el total real lo fija al
              crear el pedido. Aquí solo se ve el efecto antes de pagar. */}
          <div className="mt-4">
            {cupon ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--exito)]/10 px-3.5 py-2.5 text-sm">
                <span className="inline-flex items-center gap-2 font-medium text-[var(--disponible)]">
                  <Tag className="size-4 shrink-0" aria-hidden />
                  {cupon.codigo} {cupon.envioGratis ? "· envío gratis" : "aplicado"}
                </span>
                <button
                  type="button"
                  onClick={quitarCupon}
                  className="inline-flex items-center gap-1 text-xs text-[var(--texto-suave)] underline hover:text-[var(--texto)]"
                >
                  <X className="size-3.5" aria-hidden />
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={cuponInput}
                  onChange={(e) => setCuponInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      aplicarCupon();
                    }
                  }}
                  placeholder="¿Tienes un cupón?"
                  aria-label="Código de cupón"
                  autoCapitalize="characters"
                  className="min-w-0 flex-1 rounded-xl border bg-[var(--fondo-elevado)] px-3.5 py-2 text-sm uppercase outline-none transition-colors placeholder:normal-case placeholder:text-[var(--texto-tenue)] focus:border-[var(--acento)]"
                />
                <button
                  type="button"
                  onClick={aplicarCupon}
                  disabled={cargandoCupon || !cuponInput.trim()}
                  className="shrink-0 rounded-xl border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--fondo-hondo)] disabled:opacity-50"
                >
                  {cargandoCupon ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Aplicar"}
                </button>
              </div>
            )}
            {errorCupon && (
              <p role="alert" className="mt-1.5 text-xs text-[var(--peligro)]">
                {errorCupon}
              </p>
            )}
            {cupon?.nota && (
              <p className="mt-1.5 text-xs text-[var(--texto-tenue)]">{cupon.nota}</p>
            )}
          </div>

          {falta !== null && (
            <p className="mt-4 rounded-xl bg-[var(--fondo-hondo)] px-4 py-3 text-xs leading-relaxed text-[var(--texto-suave)]">
              Con {formatearCOP(falta)} más el envío sale gratis.
            </p>
          )}

          <div className="mt-5 flex items-baseline justify-between border-t pt-5">
            <span className="font-medium">Total</span>
            <span className="cifra text-2xl">{formatearCOP(total)}</span>
          </div>

          {errorServidor && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--peligro-fondo)] px-4 py-3 text-sm text-[var(--peligro)]"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {errorServidor}
            </p>
          )}

          {/* El pago solo existe en el último paso; antes, tocar aquí crearía
              el pedido sin datos de entrega. En móvil se oculta porque la
              barra fija de abajo lleva el mismo botón al alcance del pulgar. */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`mt-6 w-full items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3.5 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60 ${
              paso === 3 ? "hidden lg:flex" : "hidden"
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Creando el pedido…
              </>
            ) : nombrePasarela ? (
              <>
                Pagar con {nombrePasarela}
                <ArrowRight className="size-4" aria-hidden />
              </>
            ) : (
              <>
                Confirmar pedido
                <ArrowRight className="size-4" aria-hidden />
              </>
            )}
          </button>

          {nombrePasarela && !isSubmitting && (
            <p className="mt-3 text-center text-xs leading-relaxed text-[var(--texto-tenue)]">
              Te llevaremos a {nombrePasarela} para completar el pago de forma segura.
            </p>
          )}

          <p className="mt-3 text-center text-xs leading-relaxed text-[var(--texto-tenue)]">
            Al confirmar aceptas los{" "}
            <Link href="/terminos-y-condiciones/" className="underline">
              términos y condiciones
            </Link>
            .
          </p>

        </div>
      </aside>

      {/* ====================================================================
          Barra fija de móvil. El botón vivía al final de todo el formulario;
          aquí queda bajo el pulgar y con la cifra al lado, para que nadie
          toque sin ver cuánto se va a cobrar. En escritorio no aparece: allá
          el resumen ya está fijo a la derecha con su propio botón.
          ==================================================================== */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--borde)] bg-[var(--fondo-elevado)] px-4 pb-4 pt-3 shadow-lg lg:hidden">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-sm font-medium">
            {paso === 3 ? "Total a pagar" : "Total"}
          </span>
          <span className="cifra text-xl">{formatearCOP(total)}</span>
        </div>

        {paso === 3 ? (
          <>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--acento)] px-6 py-3.5 font-medium text-[var(--acento-texto)] transition-colors hover:bg-[var(--acento-hover)] disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Creando el pedido…
                </>
              ) : nombrePasarela ? (
                <>
                  Pagar con {nombrePasarela}
                  <ArrowRight className="size-4" aria-hidden />
                </>
              ) : (
                <>
                  Confirmar pedido
                  <ArrowRight className="size-4" aria-hidden />
                </>
              )}
            </button>
            {nombrePasarela && !isSubmitting && (
              <p className="mt-2 text-center text-xs text-[var(--texto-tenue)]">
                Te llevamos a {nombrePasarela} para completar el pago
              </p>
            )}
          </>
        ) : (
          <BotonPaso onClick={avanzar} />
        )}
      </div>
    </form>
  );
}
