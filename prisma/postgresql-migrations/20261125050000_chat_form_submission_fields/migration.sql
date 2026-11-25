ALTER TABLE "ChatFormSubmission"
  ADD COLUMN "fields" JSONB;

UPDATE "ChatFormSubmission" AS submission
SET "fields" = form."fields"
FROM "ChatFormInvite" AS invite
JOIN "ChatForm" AS form ON form."id" = invite."formId"
WHERE submission."inviteId" = invite."id";

ALTER TABLE "ChatFormSubmission"
  ALTER COLUMN "fields" SET NOT NULL;
