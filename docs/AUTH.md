# Autenticación

Auth.js v5 con proveedor de credenciales (correo + contraseña), adaptador de Drizzle y hash **argon2id**. No hay proveedores OAuth configurados por defecto, aunque el adaptador ya está cableado por si se agrega alguno.

## Estrategia de sesión: JWT, no base de datos

Auth.js no crea sesiones en base para el proveedor de Credentials sin sobrescribir el codificador del token, algo frágil entre versiones. Por eso la sesión es un JWT que dura 7 días (`DIAS_SESION` en `auth.ts`).

**Limitación conocida y aceptada:** con JWT no se puede cerrar la sesión de alguien desde el servidor. Si se despide a un empleado, su token sigue siendo criptográficamente válido hasta que expire. Se mitiga con `rolReal()` (ver abajo): el token seguirá abierto, pero pierde los permisos de administrador de inmediato porque el rol se relee de la base en cada carga del panel. Revocar la sesión de verdad exigiría sesiones en base de datos o una lista de revocación explícita — queda pendiente, ver [DEUDA-TECNICA.md](DEUDA-TECNICA.md).

## El rol no viaja en el token, a propósito

`auth.ts` copiaba antes el rol al JWT en el callback `jwt()`. Se quitó: nadie lo leía directamente de la sesión —la autorización siempre pasa por `rolReal()`—, y mientras tanto era una trampa esperando a que alguien escribiera `if (session.user.role === "admin")`. Un token de 7 días que dice "admin" después de que a esa persona ya se le quitó el rol es un agujero silencioso. Quitar el dato del token hace ese error imposible de cometer.

```ts
export async function rolReal(idUsuario: string): Promise<string | null> {
  const filas = await db.select({ rol: users.role }).from(users)
    .where(eq(users.id, idUsuario)).limit(1);
  return filas[0]?.rol ?? null;
}
```

## Protección de rutas: sin `middleware.ts`

No hay un `middleware.ts` global. `app/admin/layout.tsx` es `force-dynamic` y hace, en cada request:

1. `auth()` — si no hay sesión, redirige a `/entrar/`.
2. `rolReal(sesion.user.id)` — si el rol no es `admin` ni `staff`, redirige a `/` con un simple *not found* de negocio, no un "no tienes permiso" (confirmar que el panel existe en esa ruta ya es información de más).

**Cada route handler de `/api/` que escribe verifica sesión y permisos por su cuenta** — el layout no protege las rutas de API, solo las páginas. Un atacante puede llamar la API directamente sin pasar por la interfaz.

## Tabla `users`: fusión deliberada

En el diseño original de un starter con backend gestionado, `auth.users` (propiedad del proveedor) y un `profiles` aparte (con las columnas propias) suelen vivir separados porque no se pueden agregar columnas a una tabla ajena. Aquí el dueño de Postgres es la propia tienda, así que es **una sola tabla** (`lib/db/schema/auth.ts`): un JOIN menos en cada consulta autenticada.

El adaptador de Drizzle para Auth.js accede a las columnas por su nombre de **propiedad JS** (`name`, `image`), no por el nombre SQL — se aprovecha para no duplicar columnas: la propiedad `name` mapea a la columna `full_name`, `image` a `avatar_url`.

El email es único **case-insensitive** (`uniqueIndex` sobre `lower(email)`): `Juan@example.com` y `juan@example.com` son la misma cuenta, para que el login por Credentials no sea ambiguo.

## Login: sin filtración por tiempo

`authorize()` en `auth.ts` hace la búsqueda por `lower(email)`. Si el correo no existe, **igual se gasta el tiempo de calcular un hash** (`gastarTiempoComoSiExistiera`) antes de devolver `null`. Sin esto, un correo desconocido respondería casi instantáneo y uno real tardaría los ~50ms de argon2id — esa diferencia de tiempo permite enumerar qué correos tienen cuenta.

## Primer administrador: nunca desde la aplicación

El trigger `prevent_role_escalation` (conservado del schema original, reescrito sin `auth.uid()`) impide que un usuario cambie su propio rol — nadie puede auto-promoverse a admin escribiendo en su propia fila. Consecuencia necesaria: **el primer administrador de una tienda se crea a mano en el servidor**, nunca desde un formulario:

```bash
docker compose exec -e ADMIN_EMAIL=correo@example.com app node herramientas/crear-admin.cjs
```

## Recuperación de contraseña

Usa la tabla `verification_tokens` (declarada en el schema estándar de Auth.js, sin uso hasta implementarla aquí). El token viaja en claro solo por correo; en la base se guarda su **SHA-256**, no el valor ni un hash lento — la entrada son 32 bytes aleatorios, no una palabra adivinable, así que no hace falta ralentizar la verificación como con una contraseña. Vigencia: `VIGENCIA_MINUTOS = 30` (`lib/auth/constantes.ts`).

Contraseñas: mínimo `MIN_CONTRASENA = 10` caracteres, sin exigir mayúsculas ni símbolos — las reglas de composición empujan hacia contraseñas como `"Password1!"`, peor que una frase larga; la longitud es lo que de verdad encarece un ataque (criterio NIST SP 800-63B). Máximo `MAX_CONTRASENA = 200`, para evitar un DoS de CPU calculando argon2id sobre una entrada de un megabyte.

## Triggers conservados a nivel de datos

- **`prevent_role_escalation`** — nadie cambia su propio rol, ni siquiera con acceso directo a la fila.
- **`prevent_review_self_approval`** — nadie aprueba su propia reseña. Además reforzado con un `CHECK` en `reviews` (`reviews_no_self_approval_ck`): la regla no depende solo del trigger, ni siquiera un `UPDATE` a mano desde `psql` puede saltarla.

## Roles

`user_role`: `admin` | `staff` | `cliente`. `admin` y `staff` entran al panel (`app/admin/layout.tsx`); las diferencias finas de permiso entre ambos, si una tienda las necesita, se implementan en cada acción, no hay una capa genérica de permisos por rol más allá de "puede entrar al panel".

## Pendiente

Ver [DEUDA-TECNICA.md](DEUDA-TECNICA.md) para lo que falta alrededor de auth: revocación real de sesiones y rate limit explícito en el formulario de login.
