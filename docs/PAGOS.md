# Pagos

Dos pasarelas integradas y funcionando — **Mercado Pago** (Checkout Pro) y **Wompi** (checkout hospedado) — más una tercera declarada en el schema (**ePayco**) pero sin código detrás, y el pago contra entrega como valor histórico sin ofrecerse en el checkout. Ambas pasarelas activas usan checkout hospedado: el cliente sale de este servidor a pagar y los datos de tarjeta nunca lo tocan, lo que mantiene el cumplimiento PCI fuera de alcance.

## Dónde viven las llaves

Las llaves de cada pasarela se cargan desde `/admin/ajustes` y quedan **cifradas en `payment_gateways.config`** con AES-256-GCM (`lib/admin/secretos.ts`). La clave maestra de cifrado (`PAYMENT_SECRETS_ENCRYPTION_KEY`) vive en el entorno del contenedor — en un sitio distinto del respaldo de la base, para que un `pg_dump` filtrado no sea suficiente para robar nada.

El panel nunca vuelve a mostrar la llave completa: enseña si está puesta y una pista con el prefijo del proveedor y los últimos cuatro caracteres (`prv_prod_••••4f2a`). El campo de escritura empieza vacío; vacío significa "déjala como está".

Las variables `MERCADOPAGO_ACCESS_TOKEN`, `WOMPI_PRIVATE_KEY`, etc. en `.env` son solo un **respaldo** para arrancar sin usar el panel — en cuanto hay un valor guardado en la base, ese manda. La llave pública de Wompi es la excepción: no tiene variable de entorno, se pega solo desde `/admin/ajustes`.

## Flujo de checkout

```
1. Cliente envía el formulario de checkout
2. POST /api/checkout
   → create_pending_order() re-lee precios del servidor (nunca confía en el cliente)
   → bloquea las variantes ordenadas por id (evita deadlocks entre pedidos que compiten)
   → valida stock disponible
   → crea el pedido + sus items + reservas de inventario (TTL de store_settings)
   → devuelve { orderId, orderNumber, totalCop }
3. El servidor arma la redirección de la pasarela elegida
4. El cliente paga en el entorno de la pasarela (fuera del alcance PCI de este servidor)
5. La pasarela redirige de vuelta a /finalizar-compra/gracias/
6. La pasarela envía su webhook — la ÚNICA fuente de verdad del pago
```

**El retorno del paso 5 es solo interfaz.** Un cliente puede cerrar el navegador antes de volver o manipular la URL de retorno; el total que ve ahí llega firmado con HMAC (`lib/pagos/recibo.ts`, `AUTH_SECRET`) para que no se pueda alterar la cifra mostrada sin invalidar la firma, pero **el pedido se confirma únicamente por webhook**.

## Flujo de webhook y `fulfill_paid_order`

```
1. Verificar la firma con el secreto de la pasarela → si falla: rechazar, no procesar
2. Insertar en payment_events con clave única (gateway, external_id)
   → si ya existe: responder 200 de inmediato (idempotencia; la pasarela reintenta)
3. Tomar el evento (processing_started_at) y, en la misma transacción, si el
   estado es aprobado: llamar fulfill_paid_order()
4. Marcar processed_at AL FINAL de esa misma transacción
5. revalidateTag / revalidatePath del catálogo, para refrescar stock en caché
6. Responder 200
```

`fulfill_paid_order` (plpgsql, ver [BASE-DE-DATOS.md](BASE-DE-DATOS.md)) descuenta stock, libera la reserva de inventario y registra el pago, todo en una transacción. Marcar `processed_at` al final —no al recibir el evento— es lo que hace que un proceso que muere a mitad de camino no deje un evento marcado "procesado" con el pedido sin pagar: el reintento de la pasarela encuentra el evento otra vez disponible.

**Responder 200 incluso ante un evento duplicado.** Si se responde error, la pasarela reintenta indefinidamente.

## Mercado Pago — Checkout Pro

`lib/pagos/mercadopago.ts` (con acceso a base) + `lib/pagos/mercadopago-puro.ts` (funciones puras, sin `server-only`, que también usa `app/api/checkout/route.ts` y que tienen sus propias pruebas unitarias).

- **Decisión:** Checkout Pro (redirección al checkout hospedado de MP), no el Brick embebido ni la API de pagos directa. Hay que **crear una preferencia por API** (autenticada con el access token) y redirigir a la URL que devuelve — a diferencia de Wompi, esto es una llamada de red en el camino del checkout, con timeout explícito: si MP no responde, el pedido ya quedó creado y se le da el número al cliente en vez de dejarlo en una pantalla rota.
- Webhook en `app/api/pagos/mercadopago/route.ts`: verifica la firma (`firmaMercadoPagoEsValida`) y **reconsulta el pago a la API de MP** antes de tocar nada — no confía en el cuerpo del webhook por sí solo.
- Llaves guardadas en el panel: `publicKey` (informativa), `llavePrivada` (el *access token*, lo que autentica), `secretoEventos` (clave secreta del webhook). `secretoIntegridad` no aplica a Mercado Pago.

## Wompi — checkout hospedado

`lib/pagos/wompi.ts` (con acceso a base) + `lib/pagos/wompi-firma.ts` (funciones puras, con sus propias pruebas).

- El cliente sale a `checkout.wompi.co`, paga con tarjeta, PSE, Nequi, etc., y vuelve.
- **Firma de integridad:** Wompi exige un hash SHA-256 de referencia + monto + moneda + secreto para iniciar la transacción. Sin esto, la transacción es rechazada al llegar.
- Webhook en `app/api/pagos/wompi/route.ts`: llega firmado con el `events_secret`; se verifica con `eventoWompiEsAutentico` antes de procesar.
- Llaves guardadas en el panel: `publicKey`, `llavePrivada`, `secretoEventos`, `secretoIntegridad`.

## ePayco — declarada, no implementada

El enum `payment_gateway` y el seed (`lib/db/seed.ts`) incluyen `epayco` con `isEnabled: false`, y el formulario de ajustes tiene su sección. No existe código de integración: agregarla implica escribir su módulo de firma/verificación siguiendo el mismo patrón que Mercado Pago y Wompi (módulo puro + módulo con acceso a base + webhook propio), no activar un interruptor.

## Contra entrega — soportada en la base, no ofrecida

`payment_method` en `orders` acepta el valor histórico `"contra-entrega"` y el panel de administración lo entiende (filtros de entregas, correos, estado de pedido), pero `VALORES_METODO` en `lib/validaciones/pedido.ts` solo admite `"mercadopago"` y `"wompi"` — el formulario de checkout de este starter **no lo ofrece** como opción. Activarlo exige agregarlo de vuelta a `VALORES_METODO` y decidir cómo se concilia el cobro en efectivo con `payments`, además de operar la logística que implica.

## Recibo firmado de la página de gracias

`lib/pagos/recibo.ts`: el total que ve el cliente en `/finalizar-compra/gracias/` viaja firmado con HMAC-SHA256 sobre `AUTH_SECRET`, no se consulta a la base con el número de pedido como parámetro. Dos razones: los números de pedido son secuenciales (`ORD-001000`, `ORD-001001`…), así que una página pública que aceptara uno y devolviera su total sería un contador de ventas para cualquiera; y el carrito puede llevar un rato abierto con un precio que ya cambió, así que la cifra que se firma es la que de verdad quedó grabada en el pedido, no la que el navegador recordaba.

## Limitación estructural: el enum como PK

`payment_gateways.gateway` es el enum `payment_gateway`. Agregar una cuarta pasarela real exige `ALTER TYPE` en la base de datos de cada tienda que la use — manejable con instancias separadas por tienda, pero es fricción real a tener presente si se agregan pasarelas seguido.
