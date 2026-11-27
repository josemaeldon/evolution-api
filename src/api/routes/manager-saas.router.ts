import {
  deleteFile,
  getObjectUrl,
  MINIO_AVAILABLE,
  STORAGE_BACKEND,
} from '@api/integrations/storage/s3/libs/minio.server';
import { prismaRepository, sendMessageController, waMonitor } from '@api/server.module';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  getManagerPrincipal,
  globalManagerKey,
  passwordHash,
  passwordMatches,
  sameOrigin,
  sessionPrincipal,
  setManagerPrincipal,
  setSessionCookie,
} from '@api/services/manager-saas.service';
import { createManagerSocketTicket } from '@api/services/manager-socket-ticket.service';
import {
  getCompanyStorageTargetById,
  getCompanyStorageUsage,
  getMediaStorageTarget,
  pinLegacyMediaStorageTarget,
  resolveCompanyStorageTarget,
} from '@api/services/manager-storage.service';
import { Prisma } from '@prisma/client';
import { scrypt as scryptCallback } from 'crypto';
import { Router } from 'express';
import { promisify } from 'util';

const router = Router();
const scrypt = promisify(scryptCallback);
let bulkQueueRunning = false;
const BIRTHDAY_LABEL_ID = '__birthdays_today__';
const BIRTHDAY_LABEL = { id: BIRTHDAY_LABEL_ID, name: 'Aniversariantes de hoje', color: '#db2777' };
const loginAttempts = new Map<string, { count: number; until: number }>();
const mediaExtensions = (extensions: string[]): Prisma.MediaWhereInput[] =>
  extensions.map((extension) => ({ fileName: { endsWith: `.${extension}`, mode: 'insensitive' } }));
const stickerFilter: Prisma.MediaWhereInput = { type: { in: ['sticker', 'stickerMessage'] } };

async function managedInstance(req: any, res: any) {
  const principal = getManagerPrincipal(req);
  const instance = await prismaRepository.instance.findFirst({
    where: {
      id: req.params.instanceId,
      ...(principal.role === 'superadmin' ? {} : { companyId: principal.companyId }),
    },
    select: { id: true, name: true, integration: true },
  });
  if (!instance) {
    res.status(404).json(fail('Instância não encontrada'));
    return null;
  }
  return instance;
}
const imageFilter: Prisma.MediaWhereInput = {
  AND: [
    { NOT: stickerFilter },
    {
      OR: [
        { type: { in: ['image', 'imageMessage'] } },
        { mimetype: { startsWith: 'image/', mode: 'insensitive' } },
        ...mediaExtensions([
          'jpg',
          'jpeg',
          'png',
          'gif',
          'webp',
          'heic',
          'heif',
          'avif',
          'bmp',
          'tif',
          'tiff',
          'svg',
          'jxl',
        ]),
      ],
    },
  ],
};
const videoFilter: Prisma.MediaWhereInput = {
  OR: [
    { type: { in: ['video', 'videoMessage', 'ptvMessage'] } },
    { mimetype: { startsWith: 'video/', mode: 'insensitive' } },
    ...mediaExtensions(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp']),
  ],
};
const audioFilter: Prisma.MediaWhereInput = {
  OR: [
    { type: { in: ['audio', 'audioMessage'] } },
    { mimetype: { startsWith: 'audio/', mode: 'insensitive' } },
    ...mediaExtensions(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'amr']),
  ],
};
const documentFilter: Prisma.MediaWhereInput = {
  AND: [
    { NOT: { OR: [imageFilter, videoFilter, audioFilter, stickerFilter] } },
    {
      OR: [
        { type: { in: ['document', 'documentMessage'] } },
        { mimetype: { startsWith: 'application/', mode: 'insensitive' } },
        { mimetype: { startsWith: 'text/', mode: 'insensitive' } },
      ],
    },
  ],
};
const mediaTypeFilters = new Map<string, Prisma.MediaWhereInput>([
  ['image', imageFilter],
  ['video', videoFilter],
  ['audio', audioFilter],
  ['document', documentFilter],
  ['sticker', stickerFilter],
  ['other', { NOT: { OR: [imageFilter, videoFilter, audioFilter, documentFilter, stickerFilter] } }],
]);
const fail = (message: string) => ({ error: message });
const parseCalendarDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return { value, date, month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};
const birthdayDateOf = (birthDate: Date | string | null | undefined) =>
  birthDate ? new Date(birthDate).toISOString().slice(5, 10) : null;
const normalizeEmail = (email: unknown) =>
  String(email || '')
    .trim()
    .toLowerCase();
const validPassword = (value: unknown) => typeof value === 'string' && value.length >= 10 && value.length <= 128;
const safeUser = (user: {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  signMessages: boolean;
}) => ({
  id: user.id,
  companyId: user.companyId,
  name: user.name,
  email: user.email,
  role: user.role,
  active: user.active,
  signMessages: user.signMessages,
});

router.post('/login', async (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json(fail('Origem inválida'));
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  if (!email || typeof password !== 'string') return res.status(400).json(fail('Informe e-mail e senha'));
  const attemptKey = `${req.ip}:${email}`;
  const attempt = loginAttempts.get(attemptKey);
  if (attempt && attempt.count >= 5 && attempt.until > Date.now()) {
    return res.status(429).json(fail('Muitas tentativas. Tente novamente em alguns minutos'));
  }
  const user = await prismaRepository.managerUser.findUnique({ where: { email }, include: { company: true } });
  const matched = user
    ? await passwordMatches(password, user.passwordHash)
    : (await scrypt(password, 'cloudbr-chat-unknown-user', 64), false);
  if (!user || !user.active || !user.company.active || !matched) {
    if (loginAttempts.size > 10000) {
      for (const [key, value] of loginAttempts) if (value.until < Date.now()) loginAttempts.delete(key);
    }
    loginAttempts.set(attemptKey, {
      count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
      until: Date.now() + 15 * 60 * 1000,
    });
    return res.status(401).json(fail('Credenciais inválidas'));
  }
  loginAttempts.delete(attemptKey);
  const token = await createSession(user.id);
  setSessionCookie(res, token, req);
  return res.json({ ...safeUser(user), company: { id: user.company.id, name: user.company.name } });
});

router.get('/me', async (req, res) => {
  if (globalManagerKey(req)) return res.json({ role: 'superadmin', name: 'Superadministrador' });
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json(fail('Origem inválida'));
  }
  const principal = await sessionPrincipal(req);
  if (!principal) return res.status(401).json(fail('Sessão expirada'));
  const user = await prismaRepository.managerUser.findUnique({
    where: { id: principal.userId },
    include: { company: true },
  });
  if (!user) return res.status(401).json(fail('Sessão expirada'));
  return res.json({ ...safeUser(user), company: { id: user.company.id, name: user.company.name } });
});

router.post('/logout', async (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json(fail('Origem inválida'));
  await deleteSession(req);
  clearSessionCookie(res);
  return res.status(204).send();
});

router.use(async (req, res, next) => {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json(fail('Origem inválida'));
  }
  if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json(fail('Origem inválida'));
  if (globalManagerKey(req)) {
    setManagerPrincipal(req, { role: 'superadmin' });
    return next();
  }
  const principal = await sessionPrincipal(req);
  if (!principal) return res.status(401).json(fail('Sessão expirada'));
  setManagerPrincipal(req, principal);
  next();
});

router.get('/socket-ticket', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const instanceName = typeof req.query.instanceName === 'string' ? req.query.instanceName : '';
  if (!principal?.companyId || !principal.userId || !instanceName) return res.status(403).json(fail('Acesso negado'));

  const instance = await prismaRepository.instance.findFirst({
    where: { name: instanceName, companyId: principal.companyId },
    select: { id: true },
  });
  if (!instance) return res.status(403).json(fail('Instância fora da sua empresa'));

  return res.json({
    ticket: createManagerSocketTicket({ companyId: principal.companyId, instanceName }, principal.userId),
  });
});

router.get('/companies', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role === 'user') return res.status(403).json(fail('Acesso negado'));
  const companies = await prismaRepository.managerCompany.findMany({
    where: principal.role === 'superadmin' ? undefined : { id: principal.companyId },
    include: { _count: { select: { users: true, instances: true } } },
    orderBy: { name: 'asc' },
  });
  const companiesWithUsage = await Promise.all(
    companies.map(async (company) => {
      const storageTarget = resolveCompanyStorageTarget(company);
      return {
        ...company,
        storageBackend: storageTarget.backend,
        storageBucket: storageTarget.bucket,
        storageUsedBytes: (await getCompanyStorageUsage(prismaRepository, company.id)).usedBytes,
      };
    }),
  );
  return res.json(companiesWithUsage);
});

router.post('/companies', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const name = String(req.body?.name || '').trim();
  const maxInstances = Number(req.body?.maxInstances);
  const storageQuotaMb = Number(req.body?.storageQuotaMb);
  const storageBackend = req.body?.storageBackend === undefined ? STORAGE_BACKEND : String(req.body.storageBackend);
  const storageBucket = storageBackend === 'minio' ? String(req.body?.storageBucket || '').trim() : null;
  if (storageBackend === 'minio' && !MINIO_AVAILABLE) {
    return res.status(400).json(fail('Configure endpoint, chave de acesso e chave secreta do MinIO/S3 no servidor'));
  }
  if (
    !name ||
    name.length > 255 ||
    !Number.isInteger(maxInstances) ||
    maxInstances < 0 ||
    !Number.isSafeInteger(storageQuotaMb) ||
    storageQuotaMb < 0 ||
    !['local', 'minio'].includes(storageBackend) ||
    (storageBackend === 'minio' && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storageBucket || ''))
  ) {
    return res.status(400).json(fail('Informe nome e limites válidos de instâncias e armazenamento'));
  }
  if (storageBucket && (await prismaRepository.managerCompany.findUnique({ where: { storageBucket } }))) {
    return res.status(409).json(fail('Esse bucket MinIO já está atribuído a outra empresa'));
  }
  const company = await prismaRepository.managerCompany.create({
    data: { name, maxInstances, storageQuotaMb, storageBackend, storageBucket },
  });
  return res.status(201).json(company);
});

router.patch('/companies/:companyId', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const company = await prismaRepository.managerCompany.findUnique({ where: { id: req.params.companyId } });
  if (!company) return res.status(404).json(fail('Empresa não encontrada'));
  const name = req.body?.name === undefined ? company.name : String(req.body.name).trim();
  const maxInstances = req.body?.maxInstances === undefined ? company.maxInstances : Number(req.body.maxInstances);
  const storageQuotaMb =
    req.body?.storageQuotaMb === undefined ? company.storageQuotaMb : Number(req.body.storageQuotaMb);
  const currentTarget = resolveCompanyStorageTarget(company);
  const storageBackend =
    req.body?.storageBackend === undefined ? currentTarget.backend : String(req.body.storageBackend);
  const requestedBucket =
    req.body?.storageBucket === undefined ? currentTarget.bucket : String(req.body.storageBucket || '').trim();
  const storageBucket = storageBackend === 'minio' ? requestedBucket || null : null;
  const storageConfigProvided = req.body?.storageBackend !== undefined || req.body?.storageBucket !== undefined;
  if (storageConfigProvided && storageBackend === 'minio' && !MINIO_AVAILABLE) {
    return res.status(400).json(fail('Configure endpoint, chave de acesso e chave secreta do MinIO/S3 no servidor'));
  }
  const active = req.body?.active === undefined ? company.active : req.body.active;
  if (
    !name ||
    name.length > 255 ||
    !Number.isInteger(maxInstances) ||
    maxInstances < company.instanceCount ||
    !Number.isSafeInteger(storageQuotaMb) ||
    storageQuotaMb < 0 ||
    typeof active !== 'boolean' ||
    !['local', 'minio'].includes(storageBackend) ||
    (storageBackend === 'minio' && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storageBucket || ''))
  ) {
    return res.status(400).json(fail('Dados inválidos ou limite menor que os recursos em uso'));
  }
  if (storageConfigProvided && storageBucket) {
    const bucketOwner = await prismaRepository.managerCompany.findUnique({ where: { storageBucket } });
    if (bucketOwner && bucketOwner.id !== company.id) {
      return res.status(409).json(fail('Esse bucket MinIO já está atribuído a outra empresa'));
    }
  }
  if (storageConfigProvided && (storageBackend !== currentTarget.backend || storageBucket !== currentTarget.bucket)) {
    await pinLegacyMediaStorageTarget(prismaRepository, company.id, currentTarget);
  }
  const updated = await prismaRepository.managerCompany.update({
    where: { id: company.id },
    data: {
      name,
      maxInstances,
      storageQuotaMb,
      ...(storageConfigProvided ? { storageBackend, storageBucket } : {}),
      active,
    },
  });
  return res.json(updated);
});

router.delete('/companies/:companyId', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const company = await prismaRepository.managerCompany.findUnique({ where: { id: req.params.companyId } });
  if (!company) return res.status(404).json(fail('Empresa não encontrada'));

  // Keep legacy media readable after the company's storage settings are removed.
  await pinLegacyMediaStorageTarget(prismaRepository, company.id, resolveCompanyStorageTarget(company));
  // The schema sets companyId to null on instances and cascades users and sessions.
  await prismaRepository.managerCompany.delete({ where: { id: company.id } });
  return res.status(204).send();
});

router.get('/storage', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const instanceId = String(req.query.instanceId || '').trim();
  if (principal.role === 'superadmin') {
    if (!instanceId) return res.status(400).json(fail('Informe a instância'));
    const instance = await prismaRepository.instance.findUnique({
      where: { id: instanceId },
      select: {
        id: true,
        companyId: true,
        Company: { select: { storageQuotaMb: true, storageBackend: true, storageBucket: true } },
      },
    });
    if (!instance) return res.status(404).json(fail('Instância não encontrada'));
    const usage = await getCompanyStorageUsage(prismaRepository, instance.companyId, instance.id);
    return res.json({
      ...usage,
      storageQuotaMb: instance.Company?.storageQuotaMb ?? 0,
      storageEnabled: true,
      storageBackend: resolveCompanyStorageTarget(instance.Company).backend,
      storageBucket: resolveCompanyStorageTarget(instance.Company).bucket,
    });
  }

  const companyId = principal.companyId;
  if (principal.role !== 'admin' || !companyId)
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));

  const [company, usage] = await Promise.all([
    prismaRepository.managerCompany.findUnique({
      where: { id: companyId },
      select: { storageQuotaMb: true, storageBackend: true, storageBucket: true },
    }),
    getCompanyStorageUsage(prismaRepository, companyId),
  ]);
  if (!company) return res.status(404).json(fail('Empresa não encontrada'));

  return res.json({
    ...usage,
    storageQuotaMb: company.storageQuotaMb,
    storageEnabled: true,
    storageBackend: resolveCompanyStorageTarget(company).backend,
    storageBucket: resolveCompanyStorageTarget(company).bucket,
  });
});

router.get('/media', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const companyId = principal.companyId;
  const instanceId = String(req.query.instanceId || '').trim();
  if (principal.role === 'superadmin' && !instanceId) return res.status(400).json(fail('Informe a instância'));
  if (principal.role !== 'superadmin' && (principal.role !== 'admin' || !companyId))
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));

  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '50'), 10) || 50));
  const search = String(req.query.search || '').trim();
  const type = String(req.query.type || '').trim();
  const scopedInstance =
    principal.role === 'superadmin'
      ? await prismaRepository.instance.findUnique({ where: { id: instanceId }, select: { id: true, companyId: true } })
      : null;
  if (principal.role === 'superadmin' && !scopedInstance) return res.status(404).json(fail('Instância não encontrada'));
  const where: Prisma.MediaWhereInput = {
    Instance: {
      is:
        principal.role === 'superadmin' ? { id: instanceId } : { companyId, ...(instanceId ? { id: instanceId } : {}) },
    },
    ...(type ? mediaTypeFilters.get(type) || { type } : {}),
    ...(search
      ? {
          OR: [
            { fileName: { contains: search, mode: 'insensitive' } },
            { mimetype: { contains: search, mode: 'insensitive' } },
            { Instance: { is: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  const [items, total, usage] = await Promise.all([
    prismaRepository.media.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        type: true,
        mimetype: true,
        sizeBytes: true,
        createdAt: true,
        Instance: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prismaRepository.media.count({ where }),
    principal.role === 'superadmin'
      ? getCompanyStorageUsage(prismaRepository, scopedInstance!.companyId, instanceId)
      : getCompanyStorageUsage(prismaRepository, companyId!),
  ]);

  return res.json({ items, total, page, pageSize, ...usage });
});

router.get('/media/:mediaId/url', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const companyId = principal.companyId;
  const instanceId = String(req.query.instanceId || '').trim();
  if (principal.role === 'superadmin' && !instanceId) return res.status(400).json(fail('Informe a instância'));
  if (principal.role !== 'superadmin' && (principal.role !== 'admin' || !companyId))
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));
  const media = await prismaRepository.media.findFirst({
    where: {
      id: req.params.mediaId,
      Instance: { is: principal.role === 'superadmin' ? { id: instanceId } : { companyId } },
    },
    select: { fileName: true, storageBackend: true, storageBucket: true, Instance: { select: { companyId: true } } },
  });
  if (!media) return res.status(404).json(fail('Arquivo não encontrado'));
  const mediaCompanyId = media.Instance.companyId;
  const companyTarget = mediaCompanyId
    ? await getCompanyStorageTargetById(prismaRepository, mediaCompanyId)
    : resolveCompanyStorageTarget(null);
  return res.json({ url: await getObjectUrl(media.fileName, undefined, getMediaStorageTarget(media, companyTarget)) });
});

router.delete('/media', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const companyId = principal.companyId;
  const instanceId = String(req.body?.instanceId || '').trim();
  if (principal.role === 'superadmin' && !instanceId) return res.status(400).json(fail('Informe a instância'));
  if (principal.role !== 'superadmin' && (principal.role !== 'admin' || !companyId))
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string')) {
    return res.status(400).json(fail('Selecione de 1 a 500 arquivos para excluir'));
  }

  const targetInstance =
    principal.role === 'superadmin'
      ? await prismaRepository.instance.findUnique({ where: { id: instanceId }, select: { id: true, companyId: true } })
      : null;
  if (principal.role === 'superadmin' && !targetInstance) return res.status(404).json(fail('Instância não encontrada'));

  const files = await prismaRepository.media.findMany({
    where: {
      id: { in: ids },
      Instance: { is: principal.role === 'superadmin' ? { id: instanceId } : { companyId } },
    },
    include: { Message: { select: { message: true } } },
  });
  const companyTarget =
    principal.role === 'superadmin'
      ? targetInstance!.companyId
        ? await getCompanyStorageTargetById(prismaRepository, targetInstance!.companyId)
        : resolveCompanyStorageTarget(null)
      : await getCompanyStorageTargetById(prismaRepository, companyId!);
  let deleted = 0;
  for (const file of files) {
    const result = await deleteFile('evolution-api', file.fileName, getMediaStorageTarget(file, companyTarget));
    if (result) return res.status(502).json(fail('Não foi possível excluir um arquivo do armazenamento'));

    const storedMessage = file.Message.message;
    if (storedMessage && typeof storedMessage === 'object' && !Array.isArray(storedMessage)) {
      const message = { ...(storedMessage as Record<string, unknown>) };
      delete message.mediaUrl;
      delete message.base64;
      const content = message[file.type];
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        const mediaContent = { ...(content as Record<string, unknown>) };
        delete mediaContent.mediaUrl;
        delete mediaContent.base64;
        message[file.type] = mediaContent;
      }
      await prismaRepository.message.update({
        where: { id: file.messageId },
        data: { message: message as Prisma.InputJsonValue },
      });
    }

    await prismaRepository.media.delete({ where: { id: file.id } });
    deleted += 1;
  }

  return res.json({ deleted });
});

router.get('/companies/:companyId/users', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role !== 'superadmin' && principal.companyId !== req.params.companyId) {
    return res.status(403).json(fail('Acesso negado'));
  }
  if (principal.role === 'user') return res.status(403).json(fail('Acesso negado'));
  const users = await prismaRepository.managerUser.findMany({
    where: { companyId: req.params.companyId },
    orderBy: { name: 'asc' },
  });
  return res.json(users.map(safeUser));
});

router.post('/companies/:companyId/users', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role === 'user' || (principal.role !== 'superadmin' && principal.companyId !== req.params.companyId)) {
    return res.status(403).json(fail('Acesso negado'));
  }
  const company = await prismaRepository.managerCompany.findUnique({ where: { id: req.params.companyId } });
  if (!company) return res.status(404).json(fail('Empresa não encontrada'));
  const name = String(req.body?.name || '').trim();
  const email = normalizeEmail(req.body?.email);
  const role = req.body?.role;
  if (
    !name ||
    name.length > 255 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !validPassword(req.body?.password) ||
    !['admin', 'user'].includes(role)
  ) {
    return res.status(400).json(fail('Informe nome, e-mail, perfil e senha de pelo menos 10 caracteres'));
  }
  if (await prismaRepository.managerUser.findUnique({ where: { email } })) {
    return res.status(409).json(fail('E-mail já cadastrado'));
  }
  const user = await prismaRepository.managerUser.create({
    data: { companyId: company.id, name, email, role, passwordHash: await passwordHash(req.body.password) },
  });
  return res.status(201).json(safeUser(user));
});

router.patch('/users/:userId', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role === 'user') return res.status(403).json(fail('Acesso negado'));
  const target = await prismaRepository.managerUser.findUnique({ where: { id: req.params.userId } });
  if (!target) return res.status(404).json(fail('Usuário não encontrado'));
  if (principal.role !== 'superadmin' && target.companyId !== principal.companyId)
    return res.status(403).json(fail('Acesso negado'));
  const name = req.body?.name === undefined ? target.name : String(req.body.name).trim();
  const role = req.body?.role === undefined ? target.role : req.body.role;
  const active = req.body?.active === undefined ? target.active : req.body.active;
  const signMessages = req.body?.signMessages === undefined ? target.signMessages : req.body.signMessages;
  const email = req.body?.email === undefined ? target.email : normalizeEmail(req.body.email);
  if (
    !name ||
    name.length > 255 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !['admin', 'user'].includes(role) ||
    typeof active !== 'boolean' ||
    typeof signMessages !== 'boolean'
  ) {
    return res.status(400).json(fail('Dados inválidos'));
  }
  if (req.body?.password !== undefined && !validPassword(req.body.password)) {
    return res.status(400).json(fail('A senha deve ter de 10 a 128 caracteres'));
  }
  if (email !== target.email && (await prismaRepository.managerUser.findUnique({ where: { email } }))) {
    return res.status(409).json(fail('E-mail já cadastrado'));
  }
  if (principal.userId === target.id && (!active || role !== 'admin'))
    return res.status(400).json(fail('Não é possível remover seu próprio acesso'));
  const updated = await prismaRepository.managerUser.update({
    where: { id: target.id },
    data: {
      name,
      email,
      role,
      active,
      signMessages,
      ...(req.body?.password === undefined ? {} : { passwordHash: await passwordHash(req.body.password) }),
    },
  });
  if (!active || role !== target.role || req.body?.password !== undefined) {
    await prismaRepository.managerSession.deleteMany({ where: { userId: target.id } });
  }
  return res.json(safeUser(updated));
});

router.delete('/users/:userId', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role === 'user') return res.status(403).json(fail('Acesso negado'));
  const target = await prismaRepository.managerUser.findUnique({ where: { id: req.params.userId } });
  if (!target) return res.status(404).json(fail('Usuário não encontrado'));
  if (principal.role !== 'superadmin' && target.companyId !== principal.companyId)
    return res.status(403).json(fail('Acesso negado'));
  if (principal.userId === target.id) return res.status(400).json(fail('Não é possível excluir o próprio usuário'));
  const deleted = await prismaRepository.managerUser.deleteMany({
    where: { id: target.id, ...(principal.role === 'superadmin' ? {} : { companyId: principal.companyId }) },
  });
  if (!deleted.count) return res.status(404).json(fail('Usuário não encontrado'));
  return res.status(204).send();
});

router.get('/unassigned-instances', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const instances = await prismaRepository.instance.findMany({
    where: { companyId: null },
    select: { id: true, name: true, connectionStatus: true },
    orderBy: { name: 'asc' },
  });
  return res.json(instances);
});

router.get('/companies/:companyId/instances', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role === 'user' || (principal.role !== 'superadmin' && principal.companyId !== req.params.companyId)) {
    return res.status(403).json(fail('Acesso negado'));
  }
  const instances = await prismaRepository.instance.findMany({
    where: { companyId: req.params.companyId },
    select: { id: true, name: true, connectionStatus: true },
    orderBy: { name: 'asc' },
  });
  return res.json(instances);
});

router.delete('/companies/:companyId/instances/:instanceId', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const changed = await prismaRepository.instance.updateMany({
    where: { id: req.params.instanceId, companyId: req.params.companyId },
    data: { companyId: null },
  });
  if (!changed.count) return res.status(404).json(fail('Instância não vinculada à empresa'));
  await prismaRepository.managerCompany.update({
    where: { id: req.params.companyId },
    data: { instanceCount: { decrement: 1 } },
  });
  return res.status(204).send();
});

router.post('/companies/:companyId/instances/:instanceId', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const company = await prismaRepository.managerCompany.findUnique({ where: { id: req.params.companyId } });
  const instance = await prismaRepository.instance.findUnique({ where: { id: req.params.instanceId } });
  if (!company || !instance) return res.status(404).json(fail('Empresa ou instância não encontrada'));
  if (instance.companyId === company.id) return res.json({ id: instance.id, companyId: company.id });
  const reserved = await prismaRepository.managerCompany.updateMany({
    where: { id: company.id, active: true, instanceCount: { lt: company.maxInstances } },
    data: { instanceCount: { increment: 1 } },
  });
  if (!reserved.count) return res.status(409).json(fail('Limite de instâncias atingido'));
  try {
    await prismaRepository.instance.update({ where: { id: instance.id }, data: { companyId: company.id } });
    if (instance.companyId)
      await prismaRepository.managerCompany.update({
        where: { id: instance.companyId },
        data: { instanceCount: { decrement: 1 } },
      });
  } catch (error) {
    await prismaRepository.managerCompany.update({
      where: { id: company.id },
      data: { instanceCount: { decrement: 1 } },
    });
    throw error;
  }
  return res.json({ id: instance.id, companyId: company.id });
});

router.get('/instance/:instanceId/birthdays', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const date = parseCalendarDate(req.query.date);
  if (!date) return res.status(400).json(fail('Informe a data local no formato AAAA-MM-DD'));
  const contacts = await prismaRepository.contact.findMany({
    where: { instanceId: instance.id, birthDate: { not: null }, remoteJid: { endsWith: '@s.whatsapp.net' } },
    select: { id: true, remoteJid: true, pushName: true, customName: true, birthDate: true },
    orderBy: [{ customName: 'asc' }, { pushName: 'asc' }],
    take: 5000,
  });
  return res.json({
    date: date.value,
    contacts: contacts
      .filter((contact) => birthdayDateOf(contact.birthDate) === date.value.slice(5))
      .map((contact) => ({
        id: contact.id,
        remoteJid: contact.remoteJid,
        name: contact.customName?.trim() || contact.pushName?.trim() || contact.remoteJid.split('@')[0],
      })),
  });
});

router.get('/instance/:instanceId/organization', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const date = parseCalendarDate(req.query.date) || parseCalendarDate(new Date().toISOString().slice(0, 10))!;
  const [labels, contacts] = await Promise.all([
    prismaRepository.managerLabel.findMany({ where: { instanceId: instance.id }, orderBy: { name: 'asc' } }),
    prismaRepository.contact.findMany({
      where: { instanceId: instance.id, remoteJid: { endsWith: '@s.whatsapp.net' } },
      select: {
        id: true,
        remoteJid: true,
        pushName: true,
        customName: true,
        marketingOptIn: true,
        birthDate: true,
        ManagerLabels: { select: { Label: { select: { id: true, name: true, color: true } } } },
      },
      orderBy: [{ customName: 'asc' }, { pushName: 'asc' }],
      take: 2000,
    }),
  ]);
  return res.json({
    labels: [...labels, BIRTHDAY_LABEL],
    contacts: contacts.map(({ ManagerLabels, ...contact }) => ({
      ...contact,
      labels: [
        ...ManagerLabels.map(({ Label }) => Label),
        ...(birthdayDateOf(contact.birthDate) === date.value.slice(5) ? [BIRTHDAY_LABEL] : []),
      ],
    })),
  });
});

router.post('/instance/:instanceId/labels', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const name = String(req.body?.name || '').trim();
  const color = String(req.body?.color || '#2563eb');
  if (!name || name.length > 80 || !/^#[0-9a-fA-F]{6}$/.test(color))
    return res.status(400).json(fail('Informe nome e cor válidos'));
  const label = await prismaRepository.managerLabel
    .create({ data: { name, color, instanceId: instance.id } })
    .catch(() => null);
  if (!label) return res.status(409).json(fail('Já existe uma etiqueta com esse nome'));
  return res.status(201).json(label);
});

router.delete('/instance/:instanceId/labels/:labelId', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  await prismaRepository.managerLabel.deleteMany({ where: { id: req.params.labelId, instanceId: instance.id } });
  return res.status(204).send();
});

router.post('/instance/:instanceId/labels/:labelId/contacts', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const contactIds = Array.isArray(req.body?.contactIds)
    ? [...new Set<string>(req.body.contactIds.map((id: unknown) => String(id)))].filter(Boolean)
    : [];
  if (!contactIds.length || contactIds.length > 2000)
    return res.status(400).json(fail('Selecione entre 1 e 2000 contatos'));
  const label = await prismaRepository.managerLabel.findFirst({
    where: { id: req.params.labelId, instanceId: instance.id },
    select: { id: true },
  });
  if (!label) return res.status(404).json(fail('Etiqueta não encontrada'));
  const contacts = await prismaRepository.contact.findMany({
    where: { id: { in: contactIds }, instanceId: instance.id },
    select: { id: true },
  });
  if (contacts.length !== contactIds.length) return res.status(400).json(fail('Um ou mais contatos são inválidos'));
  await prismaRepository.managerLabelAssignment.createMany({
    data: contacts.map(({ id }) => ({ contactId: id, labelId: label.id })),
    skipDuplicates: true,
  });
  return res.json({ assigned: contacts.length });
});

router.put('/instance/:instanceId/contacts/:contactId/organization', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const contact = await prismaRepository.contact.findFirst({
    where: { id: req.params.contactId, instanceId: instance.id },
  });
  if (!contact) return res.status(404).json(fail('Contato não encontrado'));
  const body = req.body || {};
  const hasLabelIds = Object.prototype.hasOwnProperty.call(body, 'labelIds');
  const hasMarketingOptIn = Object.prototype.hasOwnProperty.call(body, 'marketingOptIn');
  const hasBirthDate = Object.prototype.hasOwnProperty.call(body, 'birthDate');
  if (hasLabelIds && !Array.isArray(body.labelIds)) return res.status(400).json(fail('Etiquetas inválidas'));
  const labelIds: string[] = hasLabelIds ? [...new Set<string>(body.labelIds.map((id: unknown) => String(id)))] : [];
  const validLabels = await prismaRepository.managerLabel.findMany({
    where: { id: { in: labelIds }, instanceId: instance.id },
    select: { id: true },
  });
  if (validLabels.length !== labelIds.length) return res.status(400).json(fail('Uma ou mais etiquetas são inválidas'));
  let birthDate: Date | null | undefined;
  if (hasBirthDate) {
    if (body.birthDate === null || body.birthDate === '') birthDate = null;
    else {
      const parsedBirthDate = parseCalendarDate(body.birthDate);
      if (!parsedBirthDate) return res.status(400).json(fail('Data de nascimento inválida'));
      birthDate = parsedBirthDate.date;
    }
  }

  await prismaRepository.$transaction(async (transaction) => {
    if (hasLabelIds) {
      await transaction.managerLabelAssignment.deleteMany({ where: { contactId: contact.id } });
    }
    if (labelIds.length) {
      await transaction.managerLabelAssignment.createMany({
        data: labelIds.map((labelId: string) => ({ contactId: contact.id, labelId })),
      });
    }
    if (hasMarketingOptIn || hasBirthDate) {
      await transaction.contact.update({
        where: { id: contact.id },
        data: {
          ...(hasMarketingOptIn ? { marketingOptIn: body.marketingOptIn === true } : {}),
          ...(hasBirthDate ? { birthDate } : {}),
        },
      });
    }
  });
  return res.json({ success: true });
});

router.put('/instance/:instanceId/contacts/marketing-opt-in', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const contactIds = Array.isArray(req.body?.contactIds)
    ? [...new Set<string>(req.body.contactIds.map((id: unknown) => String(id)))].filter(Boolean)
    : [];
  const marketingOptIn = req.body?.marketingOptIn;
  if (!contactIds.length || contactIds.length > 2000 || typeof marketingOptIn !== 'boolean') {
    return res.status(400).json(fail('Selecione contatos e informe a autorização'));
  }
  const contacts = await prismaRepository.contact.findMany({
    where: { id: { in: contactIds }, instanceId: instance.id, remoteJid: { endsWith: '@s.whatsapp.net' } },
    select: { id: true },
  });
  if (contacts.length !== contactIds.length) return res.status(400).json(fail('Um ou mais contatos são inválidos'));
  const result = await prismaRepository.contact.updateMany({
    where: {
      id: { in: contactIds },
      instanceId: instance.id,
      remoteJid: { endsWith: '@s.whatsapp.net' },
    },
    data: { marketingOptIn },
  });
  return res.json({ updated: result.count, marketingOptIn });
});

router.get('/instance/:instanceId/groups', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  if (instance.integration !== 'WHATSAPP-BAILEYS') {
    return res.status(400).json(fail('O envio para participantes de grupos está disponível em instâncias Baileys'));
  }
  const waInstance = waMonitor.waInstances[instance.name];
  if (!waInstance) return res.status(409).json(fail('Conecte a instância para carregar os grupos'));
  try {
    const groups = await waInstance.fetchAllGroups({ getParticipants: 'false' });
    return res.json(
      groups.map((group: { id: string; subject: string; size: number }) => ({
        id: group.id,
        subject: group.subject,
        size: group.size,
      })),
    );
  } catch {
    return res.status(502).json(fail('Não foi possível carregar os grupos da instância'));
  }
});

router.get('/instance/:instanceId/campaigns', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const campaigns = await prismaRepository.bulkCampaign.findMany({
    where: { instanceId: instance.id },
    select: {
      id: true,
      status: true,
      message: true,
      mediaFileName: true,
      intervalSeconds: true,
      createdAt: true,
      Recipients: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return res.json(
    campaigns.map(({ Recipients, ...campaign }) => ({
      ...campaign,
      counts: Recipients.reduce(
        (counts: Record<string, number>, recipient) => ({
          ...counts,
          [recipient.status]: (counts[recipient.status] || 0) + 1,
        }),
        {},
      ),
    })),
  );
});

router.post('/instance/:instanceId/campaigns', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const message = String(req.body?.message || '').trim();
  const labelIds: string[] = Array.isArray(req.body?.labelIds)
    ? [...new Set<string>(req.body.labelIds.map((id: unknown) => String(id)))]
    : [];
  const birthdaySelected = labelIds.includes(BIRTHDAY_LABEL_ID);
  const selectedLabelIds = labelIds.filter((id) => id !== BIRTHDAY_LABEL_ID);
  const groupJids: string[] = Array.isArray(req.body?.groupJids)
    ? [...new Set<string>(req.body.groupJids.map((id: unknown) => String(id)))]
    : [];
  const confirmedConsent = req.body?.confirmedConsent === true;
  const birthdayDate = birthdaySelected ? parseCalendarDate(req.body?.birthdayDate) : null;
  const randomCount = Number(req.body?.randomCount || 0);
  const intervalSeconds = Number(req.body?.intervalSeconds ?? 30);
  const image = req.body?.image;
  const imageProvided = image !== undefined && image !== null;
  const mediaData = image?.data === undefined ? null : String(image.data);
  const mediaMimeType = image?.mimetype === undefined ? null : String(image.mimetype);
  const mediaFileName =
    image?.fileName === undefined
      ? null
      : String(image.fileName)
          .replace(/[\\/]/g, '_')
          .split('')
          .filter((character) => character.charCodeAt(0) >= 32)
          .join('')
          .slice(0, 255);
  if (
    (!message && !imageProvided) ||
    message.length > 4000 ||
    labelIds.length > 50 ||
    groupJids.length > 50 ||
    groupJids.some((jid) => !jid.endsWith('@g.us')) ||
    !confirmedConsent ||
    (groupJids.length > 0 && (labelIds.length > 0 || randomCount > 0)) ||
    (birthdaySelected && !birthdayDate) ||
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 20 ||
    intervalSeconds > 60 ||
    intervalSeconds % 10 !== 0 ||
    (!labelIds.length && !randomCount && !groupJids.length) ||
    (imageProvided &&
      (typeof image.data !== 'string' ||
        !mediaData ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(mediaMimeType || '') ||
        mediaData.length > 7_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(mediaData))) ||
    (randomCount && (!Number.isInteger(randomCount) || randomCount < 1 || randomCount > 500))
  ) {
    return res.status(400).json(fail('Informe mensagem e seleção válidas (limite de 500 contatos por campanha)'));
  }
  if (
    selectedLabelIds.length &&
    (await prismaRepository.managerLabel.count({
      where: { id: { in: selectedLabelIds }, instanceId: instance.id },
    })) !== selectedLabelIds.length
  ) {
    return res.status(400).json(fail('Uma ou mais etiquetas são inválidas'));
  }

  let groupParticipantContacts: { remoteJid: string }[] = [];
  if (groupJids.length) {
    if (instance.integration !== 'WHATSAPP-BAILEYS') {
      return res.status(400).json(fail('O envio para participantes de grupos está disponível em instâncias Baileys'));
    }
    const waInstance = waMonitor.waInstances[instance.name];
    if (!waInstance) return res.status(409).json(fail('Conecte a instância para consultar os participantes'));

    const participants = new Map<string, string>();
    try {
      const availableGroups = await waInstance.fetchAllGroups({ getParticipants: 'false' });
      const availableGroupIds = new Set(availableGroups.map((group: { id: string }) => group.id));
      if (groupJids.some((groupJid) => !availableGroupIds.has(groupJid))) {
        return res.status(400).json(fail('Um ou mais grupos não pertencem à instância'));
      }
      for (const groupJid of groupJids) {
        const result = await waInstance.findParticipants({ groupJid });
        for (const participant of result?.participants || []) {
          const rawJid = String(participant.phoneNumber || participant.id || '');
          const remoteJid = rawJid.endsWith('@s.whatsapp.net')
            ? rawJid
            : rawJid.includes('@')
              ? ''
              : `${rawJid.replace(/\D/g, '')}@s.whatsapp.net`;
          if (remoteJid !== '@s.whatsapp.net' && remoteJid) {
            participants.set(remoteJid, String(participant.name || ''));
          }
        }
      }
    } catch {
      return res.status(502).json(fail('Não foi possível consultar os participantes dos grupos'));
    }

    const participantJids = [...participants.keys()];
    if (!participantJids.length)
      return res.status(400).json(fail('Não foram encontrados participantes com número disponível'));
    if (participantJids.length > 500) {
      return res.status(400).json(fail('A campanha ultrapassa o limite de 500 participantes. Selecione menos grupos.'));
    }
    await prismaRepository.contact.createMany({
      data: participantJids.map((remoteJid) => ({
        instanceId: instance.id,
        remoteJid,
        ...(participants.get(remoteJid) ? { pushName: participants.get(remoteJid) } : {}),
      })),
      skipDuplicates: true,
    });
    groupParticipantContacts = participantJids.map((remoteJid) => ({ remoteJid }));
  }
  let contacts = groupJids.length
    ? await prismaRepository.contact.findMany({
        where: {
          instanceId: instance.id,
          marketingOptIn: true,
          remoteJid: { in: groupParticipantContacts.map(({ remoteJid }) => remoteJid) },
        },
        select: { remoteJid: true },
        distinct: ['remoteJid'],
        take: 5000,
      })
    : await prismaRepository.contact.findMany({
        where: {
          instanceId: instance.id,
          marketingOptIn: true,
          remoteJid: { endsWith: '@s.whatsapp.net' },
          ...(selectedLabelIds.length || birthdaySelected
            ? {
                OR: [
                  ...(selectedLabelIds.length
                    ? [{ ManagerLabels: { some: { labelId: { in: selectedLabelIds } } } }]
                    : []),
                  ...(birthdayDate
                    ? [
                        {
                          birthDate: {
                            gte: birthdayDate.date,
                            lt: new Date(birthdayDate.date.getTime() + 24 * 60 * 60 * 1000),
                          },
                        },
                      ]
                    : []),
                ],
              }
            : {}),
        },
        select: { remoteJid: true },
        distinct: ['remoteJid'],
        take: 5000,
      });
  if (randomCount) contacts = contacts.sort(() => Math.random() - 0.5).slice(0, randomCount);
  contacts = contacts.slice(0, 500);
  if (!contacts.length) return res.status(400).json(fail('Nenhum contato autorizado para receber esta campanha'));
  const campaign = await prismaRepository.bulkCampaign.create({
    data: {
      instanceId: instance.id,
      message,
      mediaData,
      mediaMimeType,
      mediaFileName,
      status: 'queued',
      intervalSeconds,
      Recipients: { create: contacts.map(({ remoteJid }) => ({ remoteJid })) },
    },
    include: { _count: { select: { Recipients: true } } },
  });
  return res.status(201).json(campaign);
});

router.patch('/instance/:instanceId/campaigns/:campaignId', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const status = req.body?.status;
  if (!['paused', 'queued'].includes(status)) return res.status(400).json(fail('Status inválido'));
  const campaign = await prismaRepository.bulkCampaign.updateMany({
    where: { id: req.params.campaignId, instanceId: instance.id, status: { in: ['queued', 'processing', 'paused'] } },
    data: { status },
  });
  return campaign.count ? res.json({ success: true }) : res.status(404).json(fail('Campanha não encontrada'));
});

router.delete('/instance/:instanceId/campaigns/:campaignId', async (req, res) => {
  const instance = await managedInstance(req, res);
  if (!instance) return;
  const campaign = await prismaRepository.bulkCampaign.findFirst({
    where: { id: req.params.campaignId, instanceId: instance.id },
    select: { id: true, status: true },
  });
  if (!campaign) return res.status(404).json(fail('Campanha não encontrada'));
  if (campaign.status === 'processing') return res.status(409).json(fail('Pause a campanha antes de excluí-la'));
  const sending = await prismaRepository.bulkCampaignRecipient.count({
    where: { campaignId: campaign.id, status: 'sending' },
  });
  if (sending) return res.status(409).json(fail('Aguarde o envio atual terminar antes de excluir a campanha'));
  const deleted = await prismaRepository.bulkCampaign.deleteMany({
    where: { id: campaign.id, instanceId: instance.id, status: { in: ['queued', 'paused', 'completed'] } },
  });
  if (!deleted.count) return res.status(409).json(fail('Não foi possível excluir uma campanha em andamento'));
  return res.status(204).send();
});

export async function processBulkCampaignQueue() {
  if (bulkQueueRunning) return;
  bulkQueueRunning = true;
  try {
    await prismaRepository.bulkCampaignRecipient.updateMany({
      where: { status: 'sending', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: 'queued' },
    });
    const recipient = await prismaRepository.bulkCampaignRecipient.findFirst({
      where: {
        status: 'queued',
        Campaign: {
          status: { in: ['queued', 'processing'] },
          OR: [{ nextSendAt: null }, { nextSendAt: { lte: new Date() } }],
        },
      },
      include: { Campaign: { include: { Instance: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!recipient) return;
    const claimed = await prismaRepository.bulkCampaignRecipient.updateMany({
      where: { id: recipient.id, status: 'queued' },
      data: { status: 'sending' },
    });
    if (!claimed.count) return;
    await prismaRepository.bulkCampaign.update({ where: { id: recipient.campaignId }, data: { status: 'processing' } });
    try {
      const optedIn = await prismaRepository.contact.findFirst({
        where: { instanceId: recipient.Campaign.instanceId, remoteJid: recipient.remoteJid, marketingOptIn: true },
        select: {
          id: true,
          pushName: true,
          customName: true,
          birthDate: true,
          ManagerLabels: { select: { Label: { select: { name: true } } } },
        },
      });
      if (!optedIn) throw new Error('Consentimento removido antes do envio');
      const phone = recipient.remoteJid.split('@')[0];
      const name = optedIn.customName?.trim() || optedIn.pushName?.trim() || phone;
      const birthDate = optedIn.birthDate ? new Date(optedIn.birthDate) : null;
      const birthDateText = birthDate ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(birthDate) : '';
      const age = birthDate ? String(new Date().getUTCFullYear() - birthDate.getUTCFullYear()) : '';
      const variables: Record<string, string> = {
        nome: name,
        primeiro_nome: name.split(/\s+/)[0] || phone,
        telefone: phone,
        etiquetas: optedIn.ManagerLabels.map(({ Label }) => Label.name).join(', '),
        data_nascimento: birthDateText,
        aniversario: birthDate ? birthDate.toISOString().slice(5, 10).split('-').reverse().join('/') : '',
        idade: age,
      };
      const personalizedMessage = recipient.Campaign.message.replace(
        /{{\s*(nome|primeiro_nome|telefone|etiquetas|data_nascimento|aniversario|idade)\s*}}/gi,
        (_, key: string) => variables[key.toLowerCase()] || '',
      );
      if (recipient.Campaign.mediaData && recipient.Campaign.mediaMimeType) {
        await sendMessageController.sendMedia(
          { instanceName: recipient.Campaign.Instance.name },
          {
            number: phone,
            mediatype: 'image',
            mimetype: recipient.Campaign.mediaMimeType,
            fileName: recipient.Campaign.mediaFileName || 'imagem-campanha',
            caption: personalizedMessage,
            media: recipient.Campaign.mediaData,
          },
        );
      } else {
        await sendMessageController.sendText(
          { instanceName: recipient.Campaign.Instance.name },
          { number: phone, text: personalizedMessage },
        );
      }
      await prismaRepository.bulkCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'sent', sentAt: new Date() },
      });
    } catch (error) {
      await prismaRepository.bulkCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', error: String(error).slice(0, 500) },
      });
    }
    await prismaRepository.bulkCampaign.update({
      where: { id: recipient.campaignId },
      data: { nextSendAt: new Date(Date.now() + recipient.Campaign.intervalSeconds * 1000) },
    });
    const remaining = await prismaRepository.bulkCampaignRecipient.count({
      where: { campaignId: recipient.campaignId, status: 'queued' },
    });
    const sending = await prismaRepository.bulkCampaignRecipient.count({
      where: { campaignId: recipient.campaignId, status: 'sending' },
    });
    if (!remaining && !sending)
      await prismaRepository.bulkCampaign.update({
        where: { id: recipient.campaignId },
        data: { status: 'completed' },
      });
  } finally {
    bulkQueueRunning = false;
  }
}

export const managerSaasRouter = router;
