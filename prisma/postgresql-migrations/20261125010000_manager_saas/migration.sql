CREATE TABLE "ManagerCompany" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "maxInstances" INTEGER NOT NULL DEFAULT 1,
    "instanceCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagerCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerUser" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagerUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerSession" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagerSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Instance" ADD COLUMN "companyId" TEXT;
CREATE INDEX "Instance_companyId_idx" ON "Instance"("companyId");
CREATE UNIQUE INDEX "ManagerUser_email_key" ON "ManagerUser"("email");
CREATE INDEX "ManagerUser_companyId_idx" ON "ManagerUser"("companyId");
CREATE UNIQUE INDEX "ManagerSession_tokenHash_key" ON "ManagerSession"("tokenHash");
CREATE INDEX "ManagerSession_userId_idx" ON "ManagerSession"("userId");
CREATE INDEX "ManagerSession_expiresAt_idx" ON "ManagerSession"("expiresAt");
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ManagerCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagerUser" ADD CONSTRAINT "ManagerUser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ManagerCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerSession" ADD CONSTRAINT "ManagerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ManagerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
