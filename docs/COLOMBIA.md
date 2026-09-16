# Lógica de e-commerce colombiano

Lo específico del mercado colombiano. Es el núcleo reutilizable de esta base, independiente de qué venda cada tienda.

## Moneda: peso colombiano (COP)

**Enteros siempre. Nunca float, nunca decimal.** El peso colombiano no usa centavos en retail — un precio es un número entero de pesos. En base de datos: `price_cop`, `total_cop`, `shipping_cop`, todos `integer`.

```ts
// lib/formato.ts
export function formatearCOP(pesos: number): string {
  // 210000 → "$ 210.000"
}
```

**Regla:** nunca usar `toLocaleString()` directo en un componente. Siempre `formatearCOP()` (o `formatearCifra()` sin el símbolo), para que el formato sea idéntico en toda la tienda y cambiarlo sea un solo lugar.

## IVA

**Los precios mostrados incluyen IVA.** Es la convención de retail colombiano — el cliente ve el precio final. El IVA se desglosa solo para guardarlo en el pedido (`orders.tax_included_cop`), **nunca se suma encima** del precio mostrado.

`store_settings.tax_rate_bps` guarda la tarifa en **puntos básicos** (1900 = 19%), editable desde `/admin/ajustes`. El desglose se calcula dentro de `create_pending_order` (plpgsql), al momento de crear el pedido, y queda congelado ahí:

```
base = round(total * 10000 / (10000 + tax_rate_bps))
iva  = total - base
```

### Limitación actual

Una sola tarifa por tienda. Colombia tiene varias:

| Tarifa | Aplica a |
|---|---|
| 19% | Tarifa general |
| 5% | Algunos alimentos, productos agrícolas |
| Exento | Exportaciones, algunos alimentos básicos (con derecho a devolución) |
| Excluido | Servicios médicos, educación (sin derecho a devolución) |

Para una tienda de un solo tipo de producto, la tarifa única suele cubrir todo. Una tienda con catálogo mixto (por ejemplo alimentos exentos junto a productos con IVA general) necesita una columna `tax_rate_bps` por producto o por categoría — no existe todavía. Tampoco está resuelto el impuesto al consumo (INC), la retefuente, ni los "Días sin IVA".

## Envíos

Tarifa plana con umbral de envío gratis, ambos configurables por tienda:

```ts
// lib/envio.ts — puro, sin acceso a base, lo usa también el carrito en el navegador
export function calcularEnvio(subtotalCop: number, config: ConfigTienda): number {
  if (subtotalCop <= 0) return 0;
  return subtotalCop >= config.umbralEnvioGratisCop ? 0 : config.envioPlanoCop;
}
```

Los números viven **solo** en `store_settings`, leídos por `lib/data/tienda.ts` (`leerConfigTienda`, cacheada y con invalidación por tag al guardar en el panel) y nunca duplicados como constante en el frontend — evitar esa duplicación fue una decisión explícita de diseño de esta base, no una casualidad.

### Transportadoras

No hay integración con transportadoras nacionales (Servientrega, Coordinadora, Interrapidísimo, TCC). Este starter asume domicilio propio o recogida en tienda. Para envío nacional con guía y tracking, hace falta agregar esa integración — el modelo de datos de `orders` no tiene columnas para transportadora o número de guía todavía.

## Direcciones

Estructura colombiana en `tienda.config.ts → ubicacion` (ciudad y departamento de la tienda) y en `addresses` / `orders.shipping_address` (snapshot) para el cliente:

```
departamento    -- texto libre
ciudad          -- texto libre
line1           -- dirección
line2           -- opcional (apto, torre)
notes           -- opcional (portería, referencias)
```

### Limitación actual

El checkout usa **campos de texto libre**, sin lista oficial de departamentos y municipios (DANE). Suficiente para una tienda de cobertura local (`tienda.config.ts → cobertura.municipios` ya limita las opciones a una lista corta editable), no para envío nacional con cálculo de tarifa por zona.

## Pasarelas de pago: gateway vs método, sin confundir

Modelo correcto, y el que usa este starter:

```
Pasarela (gateway)     Métodos que ofrece
─────────────────      ──────────────────────────────────────
Mercado Pago           Tarjeta, PSE, Efecty, saldo en cuenta
Wompi                  Tarjeta, PSE, Nequi, Bancolombia, Daviplata, Efecty
(ninguna)               Contra entrega — soportado en el schema, no ofrecido
```

`payment_gateway` (el enum) identifica la pasarela; `orders.payment_method` guarda el método concreto que el cliente eligió. Ver [PAGOS.md](PAGOS.md) para el detalle de cada integración.

## Dato pendiente: cédula / NIT

No hay campo para documento de identidad en `orders` ni en `addresses`. Es obligatorio para:

- **PSE** — el banco lo exige en la transacción (hoy ninguna de las dos pasarelas integradas lo pide desde este checkout; conviene confirmar contra la documentación vigente de cada una antes de asumir que no hace falta).
- **Facturación electrónica DIAN** — obligatoria por ley.

Agregar `document_type` (CC, CE, NIT, PP) y `document_number` al formulario de checkout y a `orders`/`addresses` sigue pendiente.

## Facturación electrónica DIAN

**Obligatoria por ley en Colombia.** No implementada. Requiere resolución de numeración autorizada por la DIAN, XML en formato UBL 2.1, CUFE, firma digital y el envío/acuse correspondiente.

**Ruta práctica:** integrar con un proveedor tecnológico autorizado (Alegra, Siigo, Factus, World Office) en vez de implementar el protocolo directo — es lo que hace la mayoría de tiendas de este tamaño.

**Estado:** bloqueante legal para operar formalmente. Documentado, no construido.

## Cumplimiento legal

`tienda.config.ts → legal` alimenta las cuatro páginas legales (términos, privacidad, devoluciones, entrega) con razón social, NIT, plazos de reclamo y reembolso, y si aplica excepción al derecho de retracto. **El texto generado no reemplaza una revisión jurídica**: en particular el derecho de retracto (Estatuto del Consumidor, Ley 1480 de 2011) y el tratamiento de datos personales (Habeas Data, Ley 1581 de 2012) deben confirmarse con un abogado antes de lanzar cada tienda — ver el checklist de [NUEVA-TIENDA.md](NUEVA-TIENDA.md).

El aviso de cookies solo aparece si hay algo que consentir: `lib/analitica/config.ts` deriva `HAY_ANALITICA` de si `NEXT_PUBLIC_GA_ID` o `NEXT_PUBLIC_GTM_ID` están configuradas. Sin analítica, no hay cookies que pedir consentimiento para usar.

## Idioma

Español colombiano (`lang="es-CO"`), fijado en `tienda.config.ts → ubicacion.idioma`. No hay catálogo de mensajes ni i18n real — correcto para una tienda solo-Colombia; un segundo idioma es reescritura, no configuración.

## Resumen: qué está resuelto y qué no

**Resuelto:**
- Dinero en enteros COP con una única función de formato
- IVA inclusive con desglose por puntos básicos, calculado en el servidor y congelado por pedido
- Envío con una sola fuente de verdad (`store_settings`, sin constantes duplicadas en el frontend)
- Distinción correcta entre pasarela y método de pago
- Cobertura por lista corta de municipios en vez de un checkout que promete envío a cualquier parte

**Incompleto:**
- Una sola tarifa de IVA por tienda
- Sin lista DANE de departamentos y municipios
- Sin transportadoras nacionales

**Ausente por completo:**
- Captura de cédula/NIT
- Facturación electrónica DIAN
