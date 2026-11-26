ALTER TABLE "BulkCampaign"
  ADD COLUMN "mediaData" TEXT,
  ADD COLUMN "mediaMimeType" VARCHAR(100),
  ADD COLUMN "mediaFileName" VARCHAR(255);
