# Migrar una tienda desde WooCommerce

Guía para migrar una tienda WordPress + WooCommerce con años de indexación acumulada a este starter, sin perder el posicionamiento por el camino.

## La regla que lo gobierna todo

**El sitio vivo es la fuente de verdad de las URLs. El export de la base de datos no lo es.**

Parece obvio. No lo es, y saltárselo cuesta posiciones que tardaron años en construirse.

## Trampa 1: el export miente sobre las categorías

WooCommerce genera las URLs de producto con `%product_cat%`. Ese valor **no** es la primera categoría del arreglo `categories` del export — es la **categoría primaria de Yoast**, guardada en un meta aparte. Un producto puede tener `categories = ["a", "b"]` en el export y estar servido bajo `/tienda/b/` en producción. Un importador que confíe en `categories[0]` rompe esa URL sin que ningún error avise.

**Qué hacer:** construir el mapa de categorías desde el `product-sitemap.xml` del sitio en producción, no desde el export.

```bash
curl -s https://www.example.com/product-sitemap.xml -o sitemap.xml
```

Extraer cada `<loc>` y parsear la ruta. Eso da la categoría real de cada producto, la que Google tiene indexada.

**Verificar siempre** que el número de productos del sitemap coincide con el del export. Si no coincide, hay productos publicados que el export no trajo, o al revés.

## Trampa 2: los productos "sin categoría" pueden estar vivos

Es tentador ver `sin-categoria` / `uncategorized` y asumir que son basura sin valor SEO. En la práctica, aparecen productos huérfanos de categoría que siguen respondiendo `200` y aparecen en el sitemap — descartarlos sin comprobar es perder páginas indexadas.

**Qué hacer:** comprobar uno por uno con `curl` antes de decidir.

```bash
curl -s -o /dev/null -w "%{http_code}" https://www.example.com/tienda/sin-categoria/producto/
```

Si responde `200`, tiene valor. Asignarle una categoría real en el mapa y **redirigir con 301** desde la URL vieja. El 301 transfiere prácticamente toda la autoridad del enlace y Google actualiza su índice.

## Trampa 3: la misma categoría en varias rutas

WooCommerce suele dejar activas varias bases de URL a la vez para el mismo contenido:

```
/nombre-categoria/
/product-category/nombre-categoria/
/categoria-producto/nombre-categoria/
/productos/nombre-categoria/
```

Las cuatro sirven contenido duplicado. El sitio nuevo debe consolidarlas con 301 hacia una sola.

## Procedimiento

### 1. Construir el mapa canónico

```python
import re, json

xml = open("sitemap.xml").read()
mapa = {}
for u in re.findall(r"<loc>(.*?)</loc>", xml):
    m = re.match(r"https://www\.example\.com/tienda/([^/]+)/([^/]+)/?$", u)
    if m:
        cat, slug = m.groups()
        mapa[slug] = cat
```

Guardar como `wp-url-map.json`, con por cada producto: URL en WordPress, URL nueva y si requiere 301.

### 2. Contrastar con el export

```python
divergencias = [
    slug for slug, real in mapa.items()
    if (export[slug]["categories"] or [None])[0] != real
]
```

Cualquier divergencia se resuelve a favor del sitemap, nunca del export.

### 3. Las 301 se generan desde el mapa, en `next.config.ts`

Este starter deja `redirects()` vacío por defecto en `next.config.ts` — las redirecciones de una migración concreta **no viven en el repositorio del starter**, se generan por tienda desde su propio mapa de URLs:

```ts
// next.config.ts, en la tienda que está migrando
import mapaUrls from "./wp-url-map.json";

async function redirects() {
  return mapaUrls.productos
    .filter((p) => p.requiere_301)
    .map((p) => ({
      source: p.url_wordpress.replace(/\/$/, ""),
      destination: p.url_nueva.replace(/\/$/, ""),
      permanent: true,
    }));
}
```

**No escribir las entradas a mano**: se desincronizan del mapa a la primera edición. Orden importante: las rutas concretas van **antes** que los patrones genéricos, o el patrón se las come.

### 4. Trailing slash

WordPress sirve con barra final. Este starter ya trae `trailingSlash: true` en `next.config.ts` — conserva las URLs tal como están indexadas y ahorra una redirección extra en cada visita.

### 5. Verificar antes del cutover

Comprobar que el 100% de las URLs del sitemap viejo responden `200` o `301` en el sitio nuevo, ninguna `404`.

## Extraer los datos

Con acceso SSH y WP-CLI:

```bash
wp eval '
$products = wc_get_products(["status" => "publish", "limit" => -1]);
$data = [];
foreach ($products as $p) {
    $data[] = [
        "id" => $p->get_id(),
        "slug" => $p->get_slug(),
        "name" => $p->get_name(),
        "price" => $p->get_price(),
        "sku" => $p->get_sku(),
        "stock" => $p->get_stock_status(),
        "categories" => wp_get_post_terms($p->get_id(), "product_cat", ["fields" => "slugs"]),
        "description" => $p->get_description(),
        "short_desc" => $p->get_short_description(),
        "images" => array_map("wp_get_attachment_url",
            array_merge([$p->get_image_id()], $p->get_gallery_image_ids())),
    ];
}
echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
'
```

Recordar: este export **no** sirve para las URLs. Solo para el contenido.

## Limpiar el contenido

### Shortcodes de constructores visuales

Divi, Elementor y WPBakery dejan la descripción llena de shortcodes (`[et_pb_section ...]...[/et_pb_section]`). Hay que eliminarlos por completo antes de guardar `description`/`descriptionHtml` (ver [BASE-DE-DATOS.md](BASE-DE-DATOS.md)). Si al limpiar la descripción larga queda vacía, usar la descripción corta como respaldo.

### Estilos inline

WordPress suele guardar `<span style="color: #333333;">` dentro del HTML de producto. Ese color fijo **rompe el modo oscuro** el día que se active (ver [DEUDA-TECNICA.md](DEUDA-TECNICA.md)): texto gris oscuro sobre fondo oscuro. Quitar los `style` de color al importar, conservar el HTML estructural (párrafos, listas).

### Imágenes duplicadas

Los exports repiten imágenes. Deduplicar, pero con cuidado: dos archivos con el mismo nombre en extensiones distintas pueden ser formatos del mismo motivo, no un duplicado real. Incluir la extensión en la clave de deduplicación y registrar por consola qué se descartó.

### Precios

Vienen como cadena. Convertir a entero COP (ver la convención de dinero en [COLOMBIA.md](COLOMBIA.md)). Ojo: la REST API de WooCommerce puede devolver precios con decimales (`"35000.00"`); quitar los caracteres no-dígitos a lo bruto sin manejar el punto decimal explícitamente multiplica el precio por 100 sin que nada avise.

## Lista de verificación

- [ ] Sitemap descargado y mapa canónico generado
- [ ] Número de productos del sitemap == número del export
- [ ] Divergencias entre sitemap y export resueltas a favor del sitemap
- [ ] Huérfanos de categoría comprobados con `curl` y categorizados
- [ ] Redirects 301 generados desde el mapa en `next.config.ts`, no a mano
- [ ] `trailingSlash: true` (ya viene así en el starter)
- [ ] Categorías duplicadas de WooCommerce consolidadas
- [ ] Shortcodes y estilos inline limpiados
- [ ] Precios en enteros COP, sin decimales colados
- [ ] Imágenes deduplicadas sin perder formatos distintos
- [ ] Verificación de que ninguna URL vieja da 404 en el sitio nuevo
- [ ] Misma verificación repetida desde Google Search Console
- [ ] Sitemap nuevo enviado tras el cutover
- [ ] Monitoreo de 404 y posiciones durante 30 días
