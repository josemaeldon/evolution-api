CREATE TABLE `ChatForm` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `fields` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ChatForm_instanceId_idx`(`instanceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ChatForm` ADD CONSTRAINT `ChatForm_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `ChatFormInvite` (
  `id` VARCHAR(32) NOT NULL,
  `formId` VARCHAR(191) NOT NULL,
  `remoteJid` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ChatFormInvite_formId_remoteJid_idx`(`formId`, `remoteJid`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ChatFormInvite` ADD CONSTRAINT `ChatFormInvite_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `ChatForm`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `ChatFormSubmission` (
  `id` VARCHAR(191) NOT NULL,
  `inviteId` VARCHAR(32) NOT NULL,
  `answers` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ChatFormSubmission_inviteId_key`(`inviteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ChatFormSubmission` ADD CONSTRAINT `ChatFormSubmission_inviteId_fkey` FOREIGN KEY (`inviteId`) REFERENCES `ChatFormInvite`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
