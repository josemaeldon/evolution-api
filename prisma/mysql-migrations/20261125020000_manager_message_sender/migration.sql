ALTER TABLE `Message`
  ADD COLUMN `managerSenderId` VARCHAR(100) NULL,
  ADD COLUMN `managerSenderName` VARCHAR(100) NULL,
  ADD COLUMN `managerSigned` BOOLEAN NOT NULL DEFAULT false;
