ALTER TYPE "OrderStatus" ADD VALUE 'COLLECTING_CUSTOMER_DATA' AFTER 'SELECTING_PRODUCTS';

ALTER TABLE "orders"
ADD COLUMN "order_number" INTEGER,
ADD COLUMN "customer_name" VARCHAR(100),
ADD COLUMN "customer_phone" VARCHAR(16);

CREATE SEQUENCE "order_number_seq" START WITH 1000 INCREMENT BY 1;

CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

ALTER TABLE "orders"
ADD CONSTRAINT "orders_confirmed_checkout_complete"
CHECK (
  "status" <> 'CONFIRMED'
  OR (
    "order_number" IS NOT NULL
    AND "customer_name" IS NOT NULL
    AND "customer_phone" IS NOT NULL
  )
) NOT VALID;

ALTER TABLE "orders"
ADD CONSTRAINT "orders_customer_name_valid"
CHECK (
  "customer_name" IS NULL
  OR char_length(btrim("customer_name")) BETWEEN 2 AND 100
) NOT VALID;

ALTER TABLE "orders"
ADD CONSTRAINT "orders_customer_phone_valid"
CHECK (
  "customer_phone" IS NULL
  OR "customer_phone" ~ '^\+?[0-9]{8,15}$'
) NOT VALID;
