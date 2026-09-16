"use server";

import { eq, sql } from "drizzle-orm";
import { AuthError } from "next-auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { errorPg } from "@/lib/db/errores";
import { users } from "@/lib/db/schema";
import { gastarTiempoComoSiExistiera, hashearContrasena } from "@/lib/auth/contrasena";
import { esquemaEntrar, esquemaRegistro } from "@/lib/validaciones/cuenta";

/**
 * Acciones de cuenta.
 *
 * Server actions y no rutas de API: el formulario funciona aunque el
 * JavaScript no cargue, y la contraseña nunca pasa por el bundle del cliente.
 */

export type ResultadoAccion = { error: string } | undefined;

/**
 * Mensaje único para credenciales equivocadas.
 *
 * Nunca se distingue "el correo no existe" de "la contraseña está mal": esa
 * diferencia le confirma a un atacante qué correos están registrados.
 */
const CREDENCIALES_MALAS = "Correo o contraseña incorrectos.";

export async function entrar(
  _previo: ResultadoAccion,
  datos: FormData,
): Promise<ResultadoAccion> {
  const analisis = esquemaEntrar.safeParse({
    correo: datos.get("correo"),
    contrasena: datos.get("contrasena"),
  });

  if (!analisis.success) return { error: CREDENCIALES_MALAS };

  try {
    await signIn("credentials", {
      ...analisis.data,
      redirectTo: "/mi-cuenta/",
    });
  } catch (e) {
    // `signIn` redirige lanzando: hay que dejar pasar esa excepción o el
    // login se queda en la página con un error falso.
    if (isRedirectError(e)) throw e;

    if (e instanceof AuthError) return { error: CREDENCIALES_MALAS };

    console.error("entrar: fallo inesperado", e);
    return { error: "No pudimos entrar. Intenta de nuevo en un momento." };
  }
}

export async function registrar(
  _previo: ResultadoAccion,
  datos: FormData,
): Promise<ResultadoAccion> {
  const analisis = esquemaRegistro.safeParse({
    nombre: datos.get("nombre"),
    correo: datos.get("correo"),
    contrasena: datos.get("contrasena"),
    confirmacion: datos.get("confirmacion"),
  });

  if (!analisis.success) {
    const primero = analisis.error.issues[0];
    return { error: primero?.message ?? "Revisa los datos del formulario." };
  }

  const { nombre, correo, contrasena } = analisis.data;

  try {
    const yaExiste = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, correo))
      .limit(1);

    if (yaExiste.length > 0) {
      /**
       * Aquí sí se dice que el correo está tomado: en un registro es
       * inevitable —la persona necesita saberlo para poder entrar— y además
       * se puede averiguar igual intentando registrarse.
       *
       * Lo que NO puede quedar es el oráculo de TIEMPO. Sin esta espera, un
       * correo ya registrado responde tras un solo SELECT (~1 ms) y uno nuevo
       * tras dos pasadas de argon2 (>20 ms): un orden de magnitud de
       * diferencia, medible aunque el mensaje fuera idéntico, y suficiente
       * para barrer una lista de correos sin leer una sola respuesta.
       *
       * Se gasta el mismo trabajo que costaría dar de alta la cuenta.
       */
      await gastarTiempoComoSiExistiera(contrasena);
      return { error: "Ya hay una cuenta con ese correo. Intenta iniciar sesión." };
    }

    const hash = await hashearContrasena(contrasena);

    await db.insert(users).values({
      email: correo,
      name: nombre,
      passwordHash: hash,
      // El rol NO se acepta del formulario. El trigger prevent_role_escalation
      // lo bloquearía igual, pero no hay que llegar hasta ahí.
      role: "cliente",
    });
  } catch (e) {
    // Índice único: alguien registró el mismo correo entre la comprobación de
    // arriba y este insert. Se responde igual que si lo hubiéramos visto.
    //
    // El code viene envuelto por Drizzle en `.cause`; mirar `e.code` de frente
    // —como estaba— nunca acertaba, así que la carrera caía en el genérico.
    if (errorPg(e)?.code === "23505") {
      return { error: "Ya hay una cuenta con ese correo. Intenta iniciar sesión." };
    }

    // No se registra el objeto entero: su message trae el INSERT con el correo
    // y el hash. Solo el código de Postgres.
    console.error(`registrar: fallo inesperado (code=${errorPg(e)?.code ?? "?"})`);
    return { error: "No pudimos crear la cuenta. Intenta de nuevo." };
  }

  // Entra de una vez: pedirle a alguien que acaba de escribir su contraseña
  // que la escriba otra vez es fricción sin motivo.
  try {
    await signIn("credentials", { correo, contrasena, redirectTo: "/mi-cuenta/" });
  } catch (e) {
    if (isRedirectError(e)) throw e;
    // La cuenta quedó creada; solo falló el inicio automático.
    return { error: "Creamos tu cuenta. Inicia sesión para continuar." };
  }
}

export async function salir(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
