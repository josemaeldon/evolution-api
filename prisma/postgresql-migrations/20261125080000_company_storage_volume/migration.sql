ALTER TABLE "ManagerCompany"
ADD COLUMN "storageBackend" VARCHAR(20),
ADD COLUMN "storageBucket" VARCHAR(63);

CREATE UNIQUE INDEX "ManagerCompany_storageBucket_key" ON "ManagerCompany"("storageBucket");

ALTER TABLE "Media"
ADD COLUMN "storageBackend" VARCHAR(20),
ADD COLUMN "storageBucket" VARCHAR(63);
