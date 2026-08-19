-- CreateTable
CREATE TABLE "audience_subscriber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "suppressionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audience_subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_recipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerCommunicationId" TEXT NOT NULL,
    "subscriberId" TEXT,
    "email" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audience_subscriber_organizationId_unsubscribedAt_suppresse_idx" ON "audience_subscriber"("organizationId", "unsubscribedAt", "suppressedAt");

-- CreateIndex
CREATE UNIQUE INDEX "audience_subscriber_organizationId_email_key" ON "audience_subscriber"("organizationId", "email");

-- CreateIndex
CREATE INDEX "communication_recipient_organizationId_deliveredAt_idx" ON "communication_recipient"("organizationId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "communication_recipient_customerCommunicationId_email_key" ON "communication_recipient"("customerCommunicationId", "email");

-- AddForeignKey
ALTER TABLE "audience_subscriber" ADD CONSTRAINT "audience_subscriber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipient" ADD CONSTRAINT "communication_recipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipient" ADD CONSTRAINT "communication_recipient_customerCommunicationId_fkey" FOREIGN KEY ("customerCommunicationId") REFERENCES "customer_communication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipient" ADD CONSTRAINT "communication_recipient_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "audience_subscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
