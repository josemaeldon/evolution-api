CREATE TABLE `ManagerCompany` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `maxInstances` INTEGER NOT NULL DEFAULT 1,
  `instanceCount` INTEGER NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ManagerUser` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ManagerUser_email_key`(`email`),
  INDEX `ManagerUser_companyId_idx`(`companyId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ManagerSession` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ManagerSession_tokenHash_key`(`tokenHash`),
  INDEX `ManagerSession_userId_idx`(`userId`),
  INDEX `ManagerSession_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Instance` ADD COLUMN `companyId` VARCHAR(191) NULL;
CREATE INDEX `Instance_companyId_idx` ON `Instance`(`companyId`);
ALTER TABLE `Instance` ADD CONSTRAINT `Instance_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `ManagerCompany`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ManagerUser` ADD CONSTRAINT `ManagerUser_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `ManagerCompany`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ManagerSession` ADD CONSTRAINT `ManagerSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `ManagerUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
