-- ============================================================================
-- campaigns — franjas de temporada de la portada
--
-- Las campañas de temporada (Navidad, San Valentín, aniversarios…) se repiten
-- cada año y las redacta quien administra la tienda. Con el texto en el
-- repositorio, cada temporada exigía editar, compilar y desplegar; aquí se
-- edita desde /admin y la franja se enciende y se apaga sola por fechas.
--
-- La campaña NO sustituye el H1 de la portada: trae su propio título, que se
-- pinta como H2. El H1 es la señal de posicionamiento y se queda quieto todo
-- el año.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "campaigns" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"       text NOT NULL,
  "title"      text NOT NULL,
  "body"       text NOT NULL,
  "image_url"  text,
  "image_alt"  text,
  "cta_label"  text,
  "cta_href"   text,
  "starts_on"  date NOT NULL,
  "ends_on"    date NOT NULL,
  "enabled"    boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- Una campaña que termina antes de empezar no se vería nunca y nadie
  -- entendería por qué. Se rechaza al escribir, no al leer.
  CONSTRAINT "campaigns_rango_ck" CHECK ("ends_on" >= "starts_on"),

  CONSTRAINT "campaigns_title_ck" CHECK (length(btrim("title")) > 0),

  -- El botón es todo o nada: con texto y sin destino no lleva a ninguna parte;
  -- con destino y sin texto no se puede pulsar.
  CONSTRAINT "campaigns_cta_ck" CHECK (("cta_label" IS NULL) = ("cta_href" IS NULL))
);

-- La portada filtra por vigencia en cada visita.
CREATE INDEX IF NOT EXISTS "campaigns_vigencia_idx"
  ON "campaigns" USING btree ("starts_on", "ends_on");

-- updated_at al día, igual que el resto de tablas.
DROP TRIGGER IF EXISTS "trg_campaigns_updated_at" ON "campaigns";
CREATE TRIGGER "trg_campaigns_updated_at"
  BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
