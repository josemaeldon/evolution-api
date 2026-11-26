ALTER TABLE "Contact"
  ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ManagerLabel" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "color" VARCHAR(20) NOT NULL,
  "instanceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagerLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerLabel_instanceId_name_key" ON "ManagerLabel"("instanceId", "name");
CREATE INDEX "ManagerLabel_instanceId_idx" ON "ManagerLabel"("instanceId");
ALTER TABLE "ManagerLabel" ADD CONSTRAINT "ManagerLabel_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ManagerLabelAssignment" (
  "contactId" TEXT NOT NULL,
  "labelId" TEXT NOT NULL,
  CONSTRAINT "ManagerLabelAssignment_pkey" PRIMARY KEY ("contactId", "labelId")
);

CREATE INDEX "ManagerLabelAssignment_labelId_idx" ON "ManagerLabelAssignment"("labelId");
ALTER TABLE "ManagerLabelAssignment" ADD CONSTRAINT "ManagerLabelAssignment_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerLabelAssignment" ADD CONSTRAINT "ManagerLabelAssignment_labelId_fkey"
  FOREIGN KEY ("labelId") REFERENCES "ManagerLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BulkCampaign" (
  "id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "instanceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BulkCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BulkCampaign_instanceId_status_idx" ON "BulkCampaign"("instanceId", "status");
ALTER TABLE "BulkCampaign" ADD CONSTRAINT "BulkCampaign_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BulkCampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "remoteJid" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "error" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "BulkCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BulkCampaignRecipient_campaignId_remoteJid_key" ON "BulkCampaignRecipient"("campaignId", "remoteJid");
CREATE INDEX "BulkCampaignRecipient_campaignId_status_idx" ON "BulkCampaignRecipient"("campaignId", "status");
ALTER TABLE "BulkCampaignRecipient" ADD CONSTRAINT "BulkCampaignRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "BulkCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
