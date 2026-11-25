ALTER TABLE "Message"
  ADD COLUMN "managerSenderId" VARCHAR(100),
  ADD COLUMN "managerSenderName" VARCHAR(100),
  ADD COLUMN "managerSigned" BOOLEAN NOT NULL DEFAULT false;
