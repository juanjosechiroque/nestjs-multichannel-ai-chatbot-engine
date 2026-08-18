DROP INDEX "conversation_turns_conversation_id_message_id_key";

ALTER TABLE "conversation_turns"
DROP CONSTRAINT "conversation_turns_pkey",
DROP COLUMN "id",
DROP COLUMN "request_id",
DROP COLUMN "failure_code",
DROP COLUMN "completed_at",
ADD CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("conversation_id", "message_id");
