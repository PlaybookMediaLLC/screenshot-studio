ALTER TABLE "outbox_event" ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

CREATE INDEX "outbox_event_deadLetteredAt_createdAt_idx"
  ON "outbox_event"("deadLetteredAt", "createdAt");
