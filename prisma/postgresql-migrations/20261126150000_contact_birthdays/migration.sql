ALTER TABLE "Contact"
  ADD COLUMN "birthDate" DATE;

UPDATE "Contact" SET "marketingOptIn" = TRUE;
ALTER TABLE "Contact" ALTER COLUMN "marketingOptIn" SET DEFAULT TRUE;
