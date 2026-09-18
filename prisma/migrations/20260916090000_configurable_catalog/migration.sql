-- Replace the historical food-and-drink enum with business-owned catalog data.
CREATE TYPE "CatalogAttributeType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'STRING_ARRAY');

CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "search_terms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

CREATE TABLE "catalog_attributes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CatalogAttributeType" NOT NULL,
    "allowed_values" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "catalog_attributes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_attributes_key_key" ON "catalog_attributes"("key");

-- These records only bridge installations that still contain the original enum.
INSERT INTO "categories" ("slug", "label", "search_terms", "updated_at") VALUES
  ('hot-drinks', 'bebidas calientes', ARRAY['bebidas calientes', 'café caliente'], CURRENT_TIMESTAMP),
  ('cold-drinks', 'bebidas frías', ARRAY['bebidas frías', 'bebidas con hielo'], CURRENT_TIMESTAMP),
  ('food', 'comida', ARRAY['comida', 'platos', 'acompañamientos'], CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

ALTER TABLE "products" ADD COLUMN "category_id" UUID;

UPDATE "products" AS product
SET "category_id" = category_row."id"
FROM "categories" AS category_row
WHERE category_row."slug" = CASE product."category"::TEXT
  WHEN 'HOT_DRINK' THEN 'hot-drinks'
  WHEN 'COLD_DRINK' THEN 'cold-drinks'
  WHEN 'FOOD' THEN 'food'
END;

ALTER TABLE "products" ALTER COLUMN "category_id" SET NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" DROP COLUMN "category";
DROP TYPE "ProductCategory";
