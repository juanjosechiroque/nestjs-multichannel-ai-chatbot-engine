CREATE TYPE "ConversationTurnStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "conversation_turns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "message_hash" CHAR(64) NOT NULL,
    "request_id" VARCHAR(255) NOT NULL,
    "status" "ConversationTurnStatus" NOT NULL DEFAULT 'PROCESSING',
    "response" JSONB,
    "failure_code" VARCHAR(100),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_turns_conversation_id_message_id_key"
ON "conversation_turns"("conversation_id", "message_id");

CREATE INDEX "conversation_turns_status_created_at_idx"
ON "conversation_turns"("status", "created_at");

ALTER TABLE "conversation_turns"
ADD CONSTRAINT "conversation_turns_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
