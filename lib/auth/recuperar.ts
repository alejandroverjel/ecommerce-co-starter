"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";

import { SITIO } from "@/lib/sitio";
import { signIn } from "@/auth";
import { hashearContrasena } from "@/lib/auth/contrasena";
import { VIGENCIA_MINUTOS } from "@/lib/auth/constantes";
import { crearTokenRecuperacion, usarTokenRecuperacion } from "@/lib/auth/recuperacion";
import { COLORES_CORREO, enviarCorreo, plantilla } from "@/lib/correo/enviar";
import {
  esquemaCambiarContrasena,
  esquemaPedirEnlace,
} from "@/lib/validaciones/cuenta";

/**
 * Recuperar contraseña.
 *
 * Antes no existía: quien olvidaba la suya perdía el acceso a su historial de
 * pedidos para siempre, y soporte no tenía ningún camino que no pasara por
 * `crear-admin`, que además promueve la cuenta a administradora. La política de
 * privacidad ya prometía que la contraseña se podía restablecer.
 */

export type ResultadoRecuperar = { error?: string; listo?: boolean } | undefined;

/**
 * MISMA RESPUESTA SIEMPRE, exista o no la cuenta.
 *
 * Decir "ese correo no está registrado" convierte este formulario —que es
 * público y no pide contraseña— en un comprobador de correos. Se responde
 * igual en los dos casos y el trabajo pesado (crear token, mandar correo) solo
 * ocurre cuando la cuenta existe.
 */
export async function pedirEnlace(
  _previo: ResultadoRecuperar,
  datos: FormData,
): Promise<ResultadoRecuperar> {
  const analisis = esquemaPedirEnlace.safeParse({ correo: datos.get("correo") });

  if (!analisis.success) {
    return { error: "Revisa el correo, parece incompleto." };
  }

  const { correo } = analisis.data;

  try {
    const token = await crearTokenRecuperacion(correo);

    if (token) {
      const url = `${SITIO.dominio}/recuperar/cambiar/?correo=${encodeURIComponent(
        correo,
      )}&token=${encodeURIComponent(token)}`;

      await enviarCorreo({
        para: correo,
        asunto: "Restablece tu contraseña",
        html: plantilla({
          titulo: "Restablece tu contraseña",
          cuerpo: `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">
              Pediste cambiar la contraseña de tu cuenta. El enlace sirve por
              ${VIGENCIA_MINUTOS} minutos y una sola vez.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:${COLORES_CORREO.colorSuave};line-height:1.6">
              Si no fuiste tú, ignora este correo: tu contraseña no cambia
              hasta que alguien abra el enlace.
            </p>`,
          accion: { texto: "Cambiar mi contraseña", url },
        }),
        texto: `Para cambiar tu contraseña, abre este enlace (vale ${VIGENCIA_MINUTOS} minutos):\n\n${url}\n\nSi no lo pediste, ignora este correo.`,
      });
    }
  } catch (e) {
    // Ni siquiera un fallo interno debe cambiar la respuesta: si el mensaje
    // fuera distinto, la diferencia delataría qué correos existen.
    console.error(
      `recuperar: fallo generando el enlace — ${e instanceof Error ? e.name : "desconocido"}`,
    );
  }

  return { listo: true };
}

export async function cambiarContrasena(
  _previo: ResultadoRecuperar,
  datos: FormData,
): Promise<ResultadoRecuperar> {
  const analisis = esquemaCambiarContrasena.safeParse({
    correo: datos.get("correo"),
    token: datos.get("token"),
    contrasena: datos.get("contrasena"),
    confirmacion: datos.get("confirmacion"),
  });

  if (!analisis.success) {
    return { error: analisis.error.issues[0]?.message ?? "Revisa los datos." };
  }

  const { correo, token, contrasena } = analisis.data;

  try {
    const hash = await hashearContrasena(contrasena);
    const { ok } = await usarTokenRecuperacion(correo, token, hash);

    if (!ok) {
      return {
        error: `Ese enlace ya no sirve. Pide uno nuevo y ábrelo en los ${VIGENCIA_MINUTOS} minutos siguientes.`,
      };
    }
  } catch (e) {
    console.error(
      `recuperar: fallo cambiando la contraseña — ${e instanceof Error ? e.name : "desconocido"}`,
    );
    return { error: "No pudimos cambiar la contraseña. Intenta de nuevo." };
  }

  // La contraseña ya cambió: se entra de una vez en lugar de pedirla otra vez.
  try {
    await signIn("credentials", { correo, contrasena, redirectTo: "/mi-cuenta/" });
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: "Cambiamos tu contraseña. Inicia sesión para continuar." };
  }
}
