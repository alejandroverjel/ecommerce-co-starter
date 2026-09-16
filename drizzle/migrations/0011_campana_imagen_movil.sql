-- ============================================================================
-- campaigns: recorte para móvil y color de la franja
--
-- Las fotos de campaña vienen compuestas con el sujeto a un lado y fondo liso
-- al otro. En escritorio ese hueco es justo donde va el texto —por eso la foto
-- se usa a sangre—, pero en móvil, donde va arriba y entera, el mismo encuadre
-- deja medio rectángulo vacío: hace falta un recorte cerrado sobre el sujeto.
--
-- El color tapa la franja mientras la imagen carga (sin él se ve un rectángulo
-- blanco y el texto claro desaparece) y tiñe el velo que garantiza contraste.
-- Se toma del fondo de la propia foto para que no se noten dos colores.
-- ============================================================================

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "image_mobile_url" text,
  ADD COLUMN IF NOT EXISTS "background_color" text;

-- El color se interpola dentro de un linear-gradient de CSS. Aceptar texto
-- libre dejaría que un valor con paréntesis o punto y coma se colara en la
-- hoja de estilos; el patrón lo restringe a un hexadecimal.
ALTER TABLE "campaigns"
  DROP CONSTRAINT IF EXISTS "campaigns_color_ck";

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_color_ck"
  CHECK ("background_color" IS NULL OR "background_color" ~ '^#[0-9A-Fa-f]{6}$');
