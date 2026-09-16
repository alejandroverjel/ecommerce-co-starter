# Estado del camino de pago

Los seis fallos que bloqueaban el flujo de pago están cerrados, verificado contra PostgreSQL 16 real. La migración `0004_pagos.sql` reemplaza `fulfill_paid_order` con una máquina de estados explícita; `0008_guardas_pago.sql` la endurece con una guarda más.

## Por qué se reescribió en vez de parchearse

La versión anterior se corrigió tres veces contra reproducciones concretas, y la **clase** de fallo volvía por otra puerta cada vez.

El diagnóstico de fondo: las guardas preguntaban por el **estado del pedido** —que operaciones puede cambiar a mano— en vez de por el invariante. Y de las doce transiciones posibles entre los cuatro valores de `payment_status`, había **una** contemplada.

## La matriz

| Desde | Hacia | Qué pasa |
|---|---|---|
| (no existe) | cualquiera | Se inserta el pago |
| `pendiente` | `aprobado` / `rechazado` | Se aplica |
| `pendiente` | `aprobado` con monto < total | Bloqueado + revisión (0008: pagar de menos ya no confirma el pedido) |
| `pendiente` | `reembolsado` | Bloqueado + revisión (reembolso sin cobro) |
| `rechazado` | `aprobado` | Se aplica — reintento con otra tarjeta, caso normal |
| `rechazado` | `pendiente` | Se ignora (fuera de orden, sin daño) |
| `aprobado` | `reembolsado` | Se aplica — única salida legítima |
| `aprobado` | `pendiente` / `rechazado` | Bloqueado + revisión, se conserva el cobro |
| `reembolsado` | cualquiera | Bloqueado + revisión (terminal) |
| igual → igual | | No-op (evento reenviado) |
| cualquier valor nuevo del enum | | Bloqueado + revisión |

El `else` final atrapa cualquier valor que se añada al enum en el futuro: nunca se deja pasar en silencio algo que este código no entiende.

## Fallos cerrados, con su reproducción

### 1. Doble cobro silencioso

**Antes:** un pedido que quedaba en `pendiente` por otro bloqueo aceptaba una segunda transacción aprobada sin alertar. Reproducido: 159.999 COP contra un pedido de 86.000, con el segundo evento fuera de la bandeja.

**La corrección:** la guarda pregunta por el invariante —¿existe ya un pago aprobado de **otra** transacción para este pedido?— y no por el estado del pedido.

```
evento 1 (descuadre 71999): revisar=true
evento 2 (OTRA txn, correcto): revisar=true      ← antes: false
eventos en la bandeja: 2                          ← antes: 1
```

### 2. Pedido `pagado` con cero pagos

**Antes:** el upsert arbitraba por `(gateway, external_id)` global sin mirar el pedido. La misma transacción reportada contra dos pedidos dejaba al segundo pagado y sin ninguna fila de cobro: una transacción de 74.000 despachaba 148.000 en producto.

**La corrección:** una transacción ya registrada nunca se reasigna, y ningún pedido pasa a `pagado` sin una fila aprobada **suya**.

```
pedido B (misma txn): estado pendiente, filas de pago 0    ← antes: pagado
```

### 3. Monto inventado

**Antes:** `coalesce(p_amount_cop, v_total)` grababa un pago aprobado por el total del pedido cuando la pasarela no reportaba monto. Esa fila fabricada además habilitaba transiciones posteriores.

```
monto nulo → revisar=true, filas de pago inventadas: 0     ← antes: 1 aprobada
```

### 4. Evento fuera de orden que pisa el cobro

**Antes:** `aprobado` → `pendiente` reescribía monto y `raw_response`, borrando la evidencia de una disputa. Y `reembolsado` → `aprobado` resucitaba un pago devuelto **y despachaba el producto**.

**La corrección:** el congelamiento se condiciona a `paid_at is not null`, no a `status = 'aprobado'` — el propio evento puede degradar el status un instante antes, y entonces el congelamiento dejaría de proteger justo cuando hace falta.

```
tras el evento del atacante:
  estado aprobado, monto 72000, evidencia ORIGINAL         ← antes: 30000, ATACANTE
reembolsado → aprobado tardío: el pago queda reembolsado   ← antes: resucitaba
```

### 5. Stock descontado dos veces

**Antes:** el descuento dependía de que el pedido estuviera `pendiente`. Si operaciones reabría un pedido pagado —cosa que el propio mensaje de revisión sugiere hacer— el siguiente evento volvía a bajar inventario.

**La corrección:** columna `orders.stock_descontado_at`. Una marca propia e irreversible, no el estado del pedido.

```
stock tras pagar                     : 5
stock tras reabrir y volver a pagar  : 5                   ← antes: 4
```

### 6. Reembolso sin cobro previo

```
revisar=true, y la fila queda con paid_at NULL,
así que no cuenta como cobro para ningún invariante
```

## Regresiones verificadas

| Caso | Resultado |
|---|---|
| Flujo feliz completo | `pagado`, `paid_at` puesto, stock descontado, reservas liberadas |
| Webhook reenviado (mismo evento) | `ya_procesado=true`, 1 sola fila de pago |
| `rechazado` → `aprobado` (otra tarjeta) | Se aplica, pedido `pagado` |
| Reembolso legítimo tras cobro | Pedido y pago a `reembolsado`, sin alerta |
| Anti-sobreventa | Rechaza el segundo checkout por la última unidad |

## Lo que sigue pendiente

**Reembolsos parciales.** Un reembolso por menos del total marca el pago entero como `reembolsado`. Los reembolsos parciales son operación normal en muchas tiendas y necesitan su propia representación —una tabla `payment_refunds`— en vez de reescribir la fila del cobro. Hoy caen en la bandeja de revisión, que es seguro pero manual.

**Revocación de sesiones.** No es del camino de pago pero afecta al panel: con JWT no se puede cerrar la sesión de alguien desde el servidor. Ver `auth.ts`.

## Cómo verificar tras un cambio

Igual al bucle que corre `.github/workflows/desplegar.yml` en CI:

```bash
docker run -d --name pg-check -e POSTGRES_PASSWORD=test -e POSTGRES_DB=tienda -p 55450:5432 postgres:16-alpine
sleep 12
for f in drizzle/migrations/*.sql; do
  echo "-- $f"
  sed 's/--> statement-breakpoint//' "$f" \
    | docker exec -i pg-check psql -U postgres -d tienda -v ON_ERROR_STOP=1 -q
done
```

Y correr `pnpm test`, que reproduce los seis casos de arriba. Ninguno debe pasar sin `needs_review = true`.
