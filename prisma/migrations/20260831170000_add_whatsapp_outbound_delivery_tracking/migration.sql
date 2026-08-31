CREATE TYPE "WhatsAppOutboundStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED'
);

CREATE TABLE "whatsapp_outbound_messages" (
  "id" UUID NOT NULL,
  "waba_id" VARCHAR(64) NOT NULL,
  "inbound_message_id" VARCHAR(255) NOT NULL,
  "provider_message_id" VARCHAR(255),
  "status" "WhatsAppOutboundStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "webhook_received_at" TIMESTAMPTZ(3) NOT NULL,
  "customer_sent_at" TIMESTAMPTZ(3),
  "provider_accepted_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "read_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "whatsapp_outbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_outbound_messages_provider_message_id_key"
ON "whatsapp_outbound_messages"("provider_message_id");

CREATE UNIQUE INDEX "whatsapp_outbound_messages_waba_id_inbound_message_id_key"
ON "whatsapp_outbound_messages"("waba_id", "inbound_message_id");

CREATE INDEX "whatsapp_outbound_messages_status_created_at_idx"
ON "whatsapp_outbound_messages"("status", "created_at");
