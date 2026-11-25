CREATE TABLE "ChatForm" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000),
  "fields" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatForm_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatForm_instanceId_idx" ON "ChatForm"("instanceId");
ALTER TABLE "ChatForm" ADD CONSTRAINT "ChatForm_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatFormInvite" (
  "id" VARCHAR(32) NOT NULL,
  "formId" TEXT NOT NULL,
  "remoteJid" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatFormInvite_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatFormInvite_formId_remoteJid_idx" ON "ChatFormInvite"("formId", "remoteJid");
ALTER TABLE "ChatFormInvite" ADD CONSTRAINT "ChatFormInvite_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ChatForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatFormSubmission" (
  "id" TEXT NOT NULL,
  "inviteId" VARCHAR(32) NOT NULL,
  "answers" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatFormSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatFormSubmission_inviteId_key" ON "ChatFormSubmission"("inviteId");
ALTER TABLE "ChatFormSubmission" ADD CONSTRAINT "ChatFormSubmission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "ChatFormInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
