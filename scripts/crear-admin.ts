/**
 * Crea o promueve la cuenta de administración.
 *
 * POR QUÉ HACE FALTA UN SCRIPT
 *
 * El trigger `prevent_role_escalation` exige tres cosas para cambiar un rol:
 * que la conexión declare `app.user_id`, que ese actor no sea el mismo usuario,
 * y que el actor YA sea admin. Es correcto, pero deja un huevo y gallina: el
 * primer administrador no puede crearse desde la aplicación.
 *
 * Este script es la única puerta para ese arranque, y es deliberadamente
 * manual: se corre desde el servidor, deja rastro y no hay forma de dispararlo
 * desde la web.
 *
 * Uso en desarrollo:
 *   pnpm crear-admin correo@example.com
 *   echo 'una frase larga que recuerdo' | pnpm crear-admin correo@example.com --stdin
 *
 * Uso en producción (el correo y el nombre entran por variables de entorno;
 * el script se empaqueta con esbuild en herramientas/crear-admin.cjs, ver
 * package.json script `herramientas`):
 *   docker compose exec -e ADMIN_EMAIL=correo@example.com -e ADMIN_NOMBRE="Nombre Apellido" \
 *     app node herramientas/crear-admin.cjs
 */

import { randomBytes } from "node:crypto";

import { Pool } from "pg";
import { hash } from "@node-rs/argon2";

const OPCIONES_HASH = {
  algorithm: 2, // argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const c = {
  ok: (t: string) => `\x1b[32m${t}\x1b[0m`,
  mal: (t: string) => `\x1b[31m${t}\x1b[0m`,
  ojo: (t: string) => `\x1b[33m${t}\x1b[0m`,
  tenue: (t: string) => `\x1b[2m${t}\x1b[0m`,
};

/** Frase de paso legible, más fácil de dictar por teléfono que 20 símbolos. */
function generarContrasena(): string {
  return randomBytes(18).toString("base64url");
}

/** Lee la contraseña de la entrada estándar, sin eco ni historial. */
async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  const valor = Buffer.concat(trozos).toString("utf8").trim();
  if (!valor) {
    console.error(c.mal("No llegó nada por la entrada estándar."));
    process.exit(1);
  }
  return valor;
}

async function main() {
  const cadena = process.env.DATABASE_URL;
  if (!cadena) {
    console.error(c.mal("Falta DATABASE_URL"));
    process.exit(1);
  }

  // Las banderas (--stdin) no cuentan como argumentos posicionales: así
  // `ADMIN_EMAIL=... pnpm crear-admin --stdin` no toma "--stdin" por correo.
  const posicionales = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const correo = (posicionales[0] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!correo || !correo.includes("@")) {
    console.error(c.mal("Uso: pnpm crear-admin <correo> [contraseña]"));
    process.exit(1);
  }

  const nombre = (process.env.ADMIN_NOMBRE ?? "Administrador").trim();

  /**
   * La contraseña ya NO se acepta como argumento.
   *
   * `pnpm crear-admin admin@example.com "la clave"` la dejaba en el historial del
   * shell (~/.zsh_history, sin cifrar) y visible en `ps` para cualquier
   * usuario de la máquina mientras el script corriera. Para una cuenta con
   * acceso total al panel eso no compensa la comodidad.
   *
   * Quedan dos caminos: que el script la genere (lo normal), o pasarla por
   * la entrada estándar, que no toca ni el historial ni la tabla de procesos:
   *
   *   echo 'mi frase larga' | pnpm crear-admin admin@example.com --stdin
   */
  const porStdin = process.argv.includes("--stdin");

  if (posicionales[1] && !porStdin) {
    console.error(
      c.mal("No pases la contraseña como argumento: queda en el historial del shell y en `ps`."),
    );
    console.error("  Omítela y el script genera una, o usa:");
    console.error(`  echo 'tu frase larga' | pnpm crear-admin ${correo} --stdin`);
    process.exit(1);
  }

  const contrasena = porStdin ? (await leerStdin()) : generarContrasena();

  if (contrasena.length < 10) {
    console.error(c.mal("La contraseña debe tener al menos 10 caracteres"));
    process.exit(1);
  }

  const pool = new Pool({ connectionString: cadena });
  const cliente = await pool.connect();

  try {
    const hashContrasena = await hash(contrasena, OPCIONES_HASH);

    await cliente.query("begin");

    const existente = await cliente.query<{ id: string; role: string }>(
      "select id, role from users where lower(email) = $1",
      [correo],
    );

    let accion: string;

    if (existente.rowCount === 0) {
      // El trigger es `before update of role`: no cubre INSERT, así que crear
      // directamente con rol admin es legítimo y no lo elude.
      await cliente.query(
        `insert into users (email, full_name, password_hash, role)
         values ($1, $2, $3, 'admin')`,
        [correo, nombre, hashContrasena],
      );
      accion = "creada";
    } else {
      const usuario = existente.rows[0];

      if (usuario.role === "admin") {
        // Ya es admin: solo se restablece la contraseña, que no toca el rol y
        // por tanto no despierta al trigger.
        await cliente.query("update users set password_hash = $2 where id = $1", [
          usuario.id,
          hashContrasena,
        ]);
        accion = "contraseña restablecida";
      } else {
        // Promover a un usuario existente SÍ dispara el trigger, y no hay
        // ningún admin todavía que pueda figurar como actor. Se desactiva el
        // trigger solo dentro de esta transacción.
        //
        // Es la única excepción del sistema y por eso vive aquí, en un script
        // que se corre a mano en el servidor, y no en ninguna ruta de la
        // aplicación.
        await cliente.query(
          "alter table users disable trigger trg_users_prevent_role_escalation",
        );
        await cliente.query(
          "update users set role = 'admin', password_hash = $2 where id = $1",
          [usuario.id, hashContrasena],
        );
        await cliente.query(
          "alter table users enable trigger trg_users_prevent_role_escalation",
        );
        accion = `promovida de ${usuario.role} a admin`;
      }
    }

    await cliente.query("commit");

    console.log(`\n  ${c.ok("Cuenta " + accion)}`);
    console.log(`  correo     : ${correo}`);
    // Solo se imprime la que generó el script. La que llegó por stdin ya la
    // tiene quien la escribió, y repetirla en pantalla la deja en el scrollback.
    if (!porStdin) {
      console.log(`  contraseña : ${c.ojo(contrasena)}`);
      console.log(c.tenue("\n  Guárdala ya: no se vuelve a mostrar."));
    }
    console.log(c.tenue("  Entra en /entrar/ y luego ve a /admin/\n"));
  } catch (e) {
    await cliente.query("rollback").catch(() => {});
    console.error(c.mal(`\n  Error: ${e instanceof Error ? e.message : e}\n`));
    process.exitCode = 1;
  } finally {
    // El trigger se vuelve a habilitar pase lo que pase: dejarlo desactivado
    // abriría el sistema entero.
    await cliente
      .query("alter table users enable trigger trg_users_prevent_role_escalation")
      .catch(() => {});
    cliente.release();
    await pool.end();
  }
}

main();
