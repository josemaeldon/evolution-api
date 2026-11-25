CREATE TABLE `PixPaymentLink` (
    `id` VARCHAR(32) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    `charge` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `PixPaymentLink_instanceId_idx` ON `PixPaymentLink`(`instanceId`);

ALTER TABLE `PixPaymentLink` ADD CONSTRAINT `PixPaymentLink_instanceId_fkey`
    FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
