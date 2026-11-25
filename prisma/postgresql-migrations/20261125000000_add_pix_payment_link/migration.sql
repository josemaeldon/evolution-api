CREATE TABLE "PixPaymentLink" (
    "id" VARCHAR(32) NOT NULL,
    "instanceId" TEXT NOT NULL,
    "charge" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixPaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PixPaymentLink_instanceId_idx" ON "PixPaymentLink"("instanceId");

ALTER TABLE "PixPaymentLink" ADD CONSTRAINT "PixPaymentLink_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
