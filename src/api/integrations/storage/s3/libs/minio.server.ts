import { ConfigService, S3 } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import fs from 'fs/promises';
import * as MinIo from 'minio';
import { dirname, join, normalize, resolve, sep } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

const logger = new Logger('S3 Service');

const BUCKET = new ConfigService().get<S3>('S3');
const SERVER = new ConfigService().get('SERVER');
const STORAGE_BACKEND =
  process.env.MEDIA_STORAGE?.toLowerCase() === 'minio' || (!process.env.MEDIA_STORAGE && BUCKET.ENABLE)
    ? 'minio'
    : 'local';
type StorageTarget = { backend: 'local' | 'minio'; bucket?: string | null };
const defaultTarget: StorageTarget = {
  backend: STORAGE_BACKEND,
  bucket: STORAGE_BACKEND === 'minio' ? BUCKET.BUCKET_NAME : null,
};
const LOCAL_STORAGE_ROOT = resolve(process.env.MEDIA_STORAGE_PATH || join(process.cwd(), 'storage', 'media'));
const MINIO_AVAILABLE = Boolean(BUCKET.ENDPOINT && BUCKET.ACCESS_KEY && BUCKET.SECRET_KEY);

const localStoragePath = (fileName: string) => {
  const normalized = normalize(fileName).replace(/^([/\\])+/, '');
  const filePath = resolve(LOCAL_STORAGE_ROOT, normalized);
  if (filePath !== LOCAL_STORAGE_ROOT && !filePath.startsWith(`${LOCAL_STORAGE_ROOT}${sep}`)) {
    throw new BadRequestException('Invalid storage path');
  }
  return filePath;
};

const localMediaUrl = (fileName: string) => {
  const key = Buffer.from(join('evolution-api', fileName)).toString('base64url');
  return `${(SERVER.URL || '').replace(/\/$/, '')}/storage/media/${key}`;
};

interface Metadata extends MinIo.ItemBucketMetadata {
  'Content-Type': string;
}

const minioClient = (() => {
  if (MINIO_AVAILABLE) {
    return new MinIo.Client({
      endPoint: BUCKET.ENDPOINT,
      port: BUCKET.PORT,
      useSSL: BUCKET.USE_SSL,
      accessKey: BUCKET.ACCESS_KEY,
      secretKey: BUCKET.SECRET_KEY,
      region: BUCKET.REGION,
    });
  }
})();

const bucketSetup = new Map<string, Promise<void>>();
const ensureBucket = async (name: string) => {
  if (!minioClient) throw new Error('MinIO/S3 não está configurado neste servidor');
  if (bucketSetup.has(name)) return bucketSetup.get(name);
  const setup = (async () => {
    const buckets = await minioClient.listBuckets();
    if (!buckets.some((bucket) => bucket.name === name)) await minioClient.makeBucket(name);
    if (!BUCKET.SKIP_POLICY) {
      const policy = {
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${name}/*`] },
        ],
      };
      await minioClient.setBucketPolicy(name, JSON.stringify(policy));
    }
    logger.info(`S3 Bucket ${name} - ON`);
  })();
  bucketSetup.set(name, setup);
  try {
    await setup;
  } catch (error) {
    bucketSetup.delete(name);
    throw error;
  }
};

void (async () => {
  if (STORAGE_BACKEND === 'minio' && BUCKET.BUCKET_NAME) await ensureBucket(BUCKET.BUCKET_NAME);
})().catch((error) => logger.error(['S3 ERROR:', error]));

const uploadFile = async (
  fileName: string,
  file: Buffer | Transform | Readable,
  size: number,
  metadata: Metadata,
  target: StorageTarget = defaultTarget,
) => {
  if (target.backend === 'minio') {
    const bucketName = target.bucket || BUCKET.BUCKET_NAME;
    const objectName = join('evolution-api', fileName);
    try {
      await ensureBucket(bucketName);
      metadata['custom-header-application'] = 'evolution-api';
      return await minioClient.putObject(bucketName, objectName, file, size, metadata);
    } catch (error) {
      logger.error(error);
      return error;
    }
  }

  try {
    const filePath = localStoragePath(join('evolution-api', fileName));
    await fs.mkdir(dirname(filePath), { recursive: true });
    if (Buffer.isBuffer(file)) await fs.writeFile(filePath, file);
    else await pipeline(file, await fs.open(filePath, 'w').then((handle) => handle.createWriteStream()));
    return { size };
  } catch (error) {
    logger.error(error);
    return error;
  }
};

const getObjectUrl = async (fileName: string, expiry?: number, target: StorageTarget = defaultTarget) => {
  if (target.backend === 'minio') {
    try {
      const bucketName = target.bucket || BUCKET.BUCKET_NAME;
      await ensureBucket(bucketName);
      const objectName = join('evolution-api', fileName);
      if (expiry) {
        return await minioClient.presignedGetObject(bucketName, objectName, expiry);
      }
      return await minioClient.presignedGetObject(bucketName, objectName);
    } catch (error) {
      throw new BadRequestException(error?.message);
    }
  }
  return localMediaUrl(fileName);
};

const getObjectSize = async (fileName: string, target: StorageTarget = defaultTarget) => {
  if (target.backend === 'minio') {
    try {
      const bucketName = target.bucket || BUCKET.BUCKET_NAME;
      const stat = await minioClient.statObject(bucketName, join('evolution-api', fileName));
      return stat.size;
    } catch {
      return undefined;
    }
  }
  try {
    return (await fs.stat(localStoragePath(join('evolution-api', fileName)))).size;
  } catch {
    return undefined;
  }
};

const uploadTempFile = async (
  folder: string,
  fileName: string,
  file: Buffer | Transform | Readable,
  size: number,
  metadata: Metadata,
  target: StorageTarget = defaultTarget,
) => {
  if (target.backend === 'minio') {
    const objectName = join(folder, fileName);
    try {
      const bucketName = target.bucket || BUCKET.BUCKET_NAME;
      await ensureBucket(bucketName);
      metadata['custom-header-application'] = 'evolution-api';
      return await minioClient.putObject(bucketName, objectName, file, size, metadata);
    } catch (error) {
      logger.error(error);
      return error;
    }
  }
  try {
    const filePath = localStoragePath(join(folder, fileName));
    await fs.mkdir(dirname(filePath), { recursive: true });
    if (Buffer.isBuffer(file)) await fs.writeFile(filePath, file);
    else await pipeline(file, await fs.open(filePath, 'w').then((handle) => handle.createWriteStream()));
    return { size };
  } catch (error) {
    logger.error(error);
    return error;
  }
};

const deleteFile = async (folder: string, fileName: string, target: StorageTarget = defaultTarget) => {
  if (target.backend === 'minio') {
    const objectName = join(folder, fileName);
    try {
      const bucketName = target.bucket || BUCKET.BUCKET_NAME;
      return await minioClient.removeObject(bucketName, objectName);
    } catch (error) {
      logger.error(error);
      return error;
    }
  }
  try {
    await fs.unlink(localStoragePath(join(folder, fileName)));
  } catch (error) {
    logger.error(error);
    return error;
  }
};

const getLocalStorageFilePath = (fileName: string) => localStoragePath(fileName);

export {
  BUCKET,
  deleteFile,
  getLocalStorageFilePath,
  getObjectSize,
  getObjectUrl,
  MINIO_AVAILABLE,
  STORAGE_BACKEND,
  StorageTarget,
  uploadFile,
  uploadTempFile,
};
