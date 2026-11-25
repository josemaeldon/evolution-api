import { getObjectSize } from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';

const BYTES_PER_MB = 1024 * 1024;
const usageBackfills = new Map<string, Promise<void>>();

const backfillMissingMediaSizes = async (prismaRepository: PrismaRepository, companyId: string) => {
  if (usageBackfills.has(companyId)) return usageBackfills.get(companyId);

  const backfill = (async () => {
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const files = await prismaRepository.media.findMany({
        where: { sizeBytes: 0, Instance: { is: { companyId } } },
        select: { id: true, fileName: true },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: 100,
      });
      if (!files.length) {
        hasMore = false;
        continue;
      }

      const sizes = await Promise.all(
        files.map(async (file) => ({ ...file, size: await getObjectSize(file.fileName) })),
      );
      await Promise.all(
        sizes
          .filter(
            (file): file is typeof file & { size: number } =>
              Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 2147483647,
          )
          .map((file) => prismaRepository.media.update({ where: { id: file.id }, data: { sizeBytes: file.size } })),
      );
      cursor = files[files.length - 1].id;
      if (files.length < 100) hasMore = false;
    }
  })();

  usageBackfills.set(companyId, backfill);
  try {
    await backfill;
  } catch (error) {
    usageBackfills.delete(companyId);
    throw error;
  }
};

export const getCompanyStorageUsage = async (prismaRepository: PrismaRepository, companyId: string) => {
  await backfillMissingMediaSizes(prismaRepository, companyId);
  const usage = await prismaRepository.media.aggregate({
    where: { Instance: { is: { companyId } } },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });

  return {
    usedBytes: usage._sum.sizeBytes ?? 0,
    fileCount: usage._count._all,
  };
};

export const hasCompanyStorageCapacity = async (
  prismaRepository: PrismaRepository,
  instanceId: string,
  incomingBytes: number,
) => {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0 || incomingBytes > 2147483647) return false;

  const instance = await prismaRepository.instance.findUnique({
    where: { id: instanceId },
    select: { companyId: true },
  });
  if (!instance?.companyId) return true;

  const [company, usage] = await Promise.all([
    prismaRepository.managerCompany.findUnique({
      where: { id: instance.companyId },
      select: { storageQuotaMb: true },
    }),
    getCompanyStorageUsage(prismaRepository, instance.companyId),
  ]);
  if (!company) return true;

  return usage.usedBytes + incomingBytes <= company.storageQuotaMb * BYTES_PER_MB;
};
