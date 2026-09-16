"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/lib/db";
import { paymentGateways, storeSettings, users } from "@/lib/db/schema";
import { ejecutar, exigirAdmin, type ResultadoAccion } from "@/lib/admin/guardia";
import {
  cifrarSecreto,
  hayLlaveMaestra,
  leerSecretoPasarela,
  NOMBRES_SECRETO,
  type ConfigPasarela,
  type SecretoGuardado,
} from "@/lib/admin/secretos";
import {
  esquemaAjustesTienda,
  esquemaCambioRol,
  esquemaPasarela,
  estaIntegrada,
} from "@/lib/validaciones/ajustes";

/**
 * Acciones de ajustes, pasarelas y roles.
 *
 * Las tres exigen ADMIN, no personal: el equipo prepara pedidos, no cambia el
 * IVA ni reparte permisos. `exigirAdmin()` relee el rol de la base, así que a
 * un administrador degradado le deja de funcionar al instante aunque su token
 * siga diciendo "admin" durante siete días.
 *
 * Volver a comprobar aquí no es redundante con el layout: una server action es
 * un endpoint POST y se puede invocar sin pasar nunca por la página.
 */

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? "");
const casilla = (datos: FormData, campo: string) => datos.get(campo) === "on";

/** Los formularios son largos; enseñar los errores de uno en uno cansa. */
function primerosErrores(error: z.ZodError): string {
  const mensajes = [...new Set(error.issues.map((i) => i.message))];
  return mensajes.slice(0, 3).join(" · ");
}

// ============================================================================
// A) Ajustes de la tienda
// ============================================================================

export async function guardarAjustesTienda(
  _previo: ResultadoAccion | null,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("ajustes/tienda", async () => {
    await exigirAdmin();

    const analisis = esquemaAjustesTienda.safeParse({
      envioPlanoCop: texto(datos, "envioPlanoCop"),
      umbralEnvioGratisCop: texto(datos, "umbralEnvioGratisCop"),
      minutosReserva: texto(datos, "minutosReserva"),
    });

    if (!analisis.success) {
      return { ok: false, error: primerosErrores(analisis.error) };
    }

    const d = analisis.data;

    const filas = await db
      .update(storeSettings)
      .set({
        flatShippingCop: d.envioPlanoCop,
        freeShippingThresholdCop: d.umbralEnvioGratisCop,
        reservationTtlMinutes: d.minutosReserva,
        // Explícito y no solo el $onUpdate del schema: es la marca que el
        // seed usa (`WHERE updated_at = created_at`) para saber que la fila
        // ya no está de fábrica y dejar de alinearla con TIENDA.envioInicial.
        updatedAt: new Date(),
      })
      .where(eq(storeSettings.id, true))
      .returning({ id: storeSettings.id });

    // La tabla es un singleton: si no hay fila que actualizar, nunca se corrió
    // el seed y `create_pending_order` estaría cobrando envío 0.
    if (filas.length === 0) {
      return {
        ok: false,
        error: "store_settings está vacía. Corre `pnpm db:seed` antes de tocar esto.",
      };
    }

    // El caché de leerConfigTienda (envío, umbral) se invalida al instante:
    // sin esto el checkout seguiría cobrando el envío viejo hasta una hora.
    revalidateTag("config-tienda", "max");
    revalidatePath("/admin/ajustes");
    // El envío y el umbral se pintan en el carrito y en el checkout, y el IVA
    // en cada ficha de producto. Los datos de contacto NO se tocan aquí: viven
    // en lib/sitio.ts, ver la nota en components/admin/formulario-ajustes.tsx.
    revalidatePath("/carrito");
    revalidatePath("/finalizar-compra");
    revalidatePath("/tienda/[categoria]/[producto]", "page");

    return { ok: true, mensaje: "Ajustes guardados. Aplican desde el próximo pedido." };
  });
}

// ============================================================================
// B) Pasarelas de pago
// ============================================================================

export async function guardarPasarela(
  _previo: ResultadoAccion | null,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("ajustes/pasarela", async () => {
    await exigirAdmin();

    const analisis = esquemaPasarela.safeParse({
      pasarela: texto(datos, "pasarela"),
      habilitada: casilla(datos, "habilitada"),
      pruebas: casilla(datos, "pruebas"),
      llavePublica: texto(datos, "llavePublica"),
      llavePrivada: texto(datos, "llavePrivada"),
      secretoEventos: texto(datos, "secretoEventos"),
      secretoIntegridad: texto(datos, "secretoIntegridad"),
      borrarSecretos: casilla(datos, "borrarSecretos"),
    });

    if (!analisis.success) {
      return { ok: false, error: primerosErrores(analisis.error) };
    }

    const d = analisis.data;

    // El checkout solo sabe cobrar con las pasarelas integradas (Mercado Pago
    // y Wompi). Encender otra pondría un método de pago que ningún código
    // procesa: el pedido quedaría pendiente para siempre y el cliente
    // creyendo que pagó.
    if (d.habilitada && !estaIntegrada(d.pasarela)) {
      return {
        ok: false,
        error: `${d.pasarela} no está integrada todavía; encenderla dejaría pedidos sin cobrar.`,
      };
    }

    const filas = await db
      .select({ config: paymentGateways.config })
      .from(paymentGateways)
      .where(eq(paymentGateways.gateway, d.pasarela))
      .limit(1);

    if (filas.length === 0) {
      return { ok: false, error: "Esa pasarela no está declarada en la base." };
    }

    const configActual = (filas[0].config ?? {}) as ConfigPasarela;
    const secretos: Partial<Record<(typeof NOMBRES_SECRETO)[number], SecretoGuardado>> =
      d.borrarSecretos ? {} : { ...(configActual.secretos ?? {}) };

    const nuevos = {
      llavePrivada: d.llavePrivada,
      secretoEventos: d.secretoEventos,
      secretoIntegridad: d.secretoIntegridad,
    };

    const hayNuevos = NOMBRES_SECRETO.some((n) => nuevos[n] !== null);

    // Falla cerrado: sin llave maestra no se guarda en claro "por esta vez".
    if (hayNuevos && !hayLlaveMaestra()) {
      return {
        ok: false,
        error:
          "Falta PAYMENT_SECRETS_ENCRYPTION_KEY en el servidor. Genérala con " +
          "`openssl rand -base64 32` y reinicia el contenedor antes de guardar llaves.",
      };
    }

    for (const nombre of NOMBRES_SECRETO) {
      const valor = nuevos[nombre];
      if (valor !== null) secretos[nombre] = cifrarSecreto(valor, d.pasarela, nombre);
    }

    // Sin llave privada no se pueden verificar los webhooks: la tienda daría
    // por pagado cualquier POST que llegue a la URL del webhook.
    if (d.habilitada && !secretos.llavePrivada) {
      /**
       * Con "borrar los secretos" marcado, la llave guardada está a punto de
       * desaparecer: consultarla como respaldo encontraría la vieja, daría la
       * guarda por superada, y el update de abajo dejaría la pasarela
       * ENCENDIDA y sin ninguna llave. El checkout intentaría cobrar contra
       * una configuración vacía.
       *
       * El esquema ya prohíbe borrar y escribir llaves nuevas a la vez, pero
       * no prohibía borrar y encender.
       */
      const deRespaldo = d.borrarSecretos
        ? null
        : await leerSecretoPasarela(d.pasarela, "llavePrivada");

      if (!deRespaldo) {
        return {
          ok: false,
          error: d.borrarSecretos
            ? "No puedes borrar los secretos y dejar la pasarela encendida: quedaría sin llave para cobrar."
            : "Para encender la pasarela hace falta también la llave privada.",
        };
      }
    }

    await db
      .update(paymentGateways)
      .set({
        isEnabled: d.habilitada,
        isSandbox: d.pruebas,
        publicKey: d.llavePublica,
        config: { ...configActual, secretos },
      })
      .where(eq(paymentGateways.gateway, d.pasarela));

    revalidatePath("/admin/ajustes");
    revalidatePath("/finalizar-compra");

    return {
      ok: true,
      mensaje: d.borrarSecretos
        ? "Pasarela guardada y secretos borrados."
        : "Pasarela guardada.",
    };
  });
}

// ============================================================================
// C) Roles
// ============================================================================

type FilaBloqueada = {
  id: string;
  role: "admin" | "staff" | "cliente";
  email: string;
  full_name: string | null;
};

export async function cambiarRolUsuario(
  _previo: ResultadoAccion | null,
  datos: FormData,
): Promise<ResultadoAccion> {
  return ejecutar("ajustes/rol", async () => {
    const actor = await exigirAdmin();

    const analisis = esquemaCambioRol.safeParse({
      usuarioId: texto(datos, "usuarioId"),
      rol: texto(datos, "rol"),
    });

    if (!analisis.success) {
      return { ok: false, error: primerosErrores(analisis.error) };
    }

    const { usuarioId, rol } = analisis.data;

    /**
     * TODO el cambio va dentro de UNA transacción por dos motivos distintos:
     *
     * 1. `prevent_role_escalation` exige `app.user_id`, y `SET LOCAL` muere con
     *    la sentencia si no hay transacción abierta. Con el pool de pg, la
     *    siguiente consulta podría además salir por otra conexión, que no
     *    tendría la variable puesta. El tercer argumento `true` de set_config
     *    es lo que lo hace LOCAL.
     *
     * 2. La regla de "no dejar la tienda sin administradores" se comprueba
     *    contando filas. Sin bloquearlas, dos degradaciones simultáneas
     *    contarían dos administradores cada una y se quitarían los dos.
     */
    const resultado = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${actor.id}, true)`);

      /**
       * Se bloquean de una vez los administradores y el objetivo, ORDENADOS
       * POR id: el mismo orden en todas las transacciones, que es lo que evita
       * el abrazo mortal cuando dos cambios compiten por las mismas filas.
       */
      const { rows } = await tx.execute<FilaBloqueada>(sql`
        select id, role, email, full_name
          from users
         where role = 'admin' or id = ${usuarioId}::uuid
         order by id
           for update
      `);

      const objetivo = rows.find((f) => f.id === usuarioId);
      if (!objetivo) {
        return { ok: false as const, error: "Esa cuenta ya no existe." };
      }

      // El trigger también lo bloquea, pero con un mensaje de Postgres. Aquí
      // se explica por qué: es la regla de los cuatro ojos, no un fallo.
      if (objetivo.id === actor.id) {
        return {
          ok: false as const,
          error: "No puedes cambiar tu propio rol. Pídeselo a otro administrador.",
        };
      }

      if (objetivo.role === rol) {
        return { ok: true as const, mensaje: "Esa cuenta ya tenía ese rol." };
      }

      const administradores = rows.filter((f) => f.role === "admin");
      if (objetivo.role === "admin" && administradores.length <= 1) {
        return {
          ok: false as const,
          error:
            "Es la única cuenta con administración. Nombra a otro administrador antes de quitarle el rol a este.",
        };
      }

      await tx.update(users).set({ role: rol }).where(eq(users.id, usuarioId));

      const quien = objetivo.full_name ?? objetivo.email;
      return { ok: true as const, mensaje: `${quien} ahora es ${ETIQUETA_ROL[rol]}.` };
    });

    if (resultado.ok) revalidatePath("/admin/clientes");

    return resultado;
  });
}

const ETIQUETA_ROL: Record<"admin" | "staff" | "cliente", string> = {
  admin: "administrador",
  staff: "equipo",
  cliente: "cliente",
};
