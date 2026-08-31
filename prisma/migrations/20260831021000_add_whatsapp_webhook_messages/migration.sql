CREATE TABLE "whatsapp_webhook_messages" (
    "waba_id" VARCHAR(64) NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_webhook_messages_pkey" PRIMARY KEY ("waba_id", "message_id")
);

CREATE INDEX "whatsapp_webhook_messages_received_at_idx"
ON "whatsapp_webhook_messages"("received_at");
