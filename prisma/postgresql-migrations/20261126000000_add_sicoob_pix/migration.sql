ALTER TABLE "PixPaymentLink"
  ADD COLUMN "provider" VARCHAR(20) NOT NULL DEFAULT 'static',
  ADD COLUMN "txid" VARCHAR(35),
  ADD COLUMN "remoteJid" VARCHAR(100),
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "endToEndId" VARCHAR(100),
  ADD COLUMN "notifiedAt" TIMESTAMP(3),
  ADD COLUMN "claimAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PixPaymentLink_txid_key" ON "PixPaymentLink"("txid");
CREATE INDEX "PixPaymentLink_provider_status_idx" ON "PixPaymentLink"("provider", "status");

CREATE TABLE "SicoobPixConfig" (
  "instanceId" TEXT NOT NULL,
  "clientId" VARCHAR(255) NOT NULL,
  "clientSecret" TEXT NOT NULL,
  "pixKey" VARCHAR(77) NOT NULL,
  "merchantName" VARCHAR(100) NOT NULL,
  "merchantCity" VARCHAR(100) NOT NULL,
  "tokenUrl" VARCHAR(500) NOT NULL,
  "apiUrl" VARCHAR(500) NOT NULL,
  "sandboxMode" BOOLEAN NOT NULL DEFAULT false,
  "expiresIn" INTEGER NOT NULL DEFAULT 900,
  "certPem" TEXT NOT NULL,
  "keyPem" TEXT NOT NULL,
  "caPem" TEXT,
  "webhookSecret" VARCHAR(64) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SicoobPixConfig_pkey" PRIMARY KEY ("instanceId")
);

ALTER TABLE "SicoobPixConfig" ADD CONSTRAINT "SicoobPixConfig_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
