import {
  deleteFile,
  getObjectUrl,
  MINIO_AVAILABLE,
  STORAGE_BACKEND,
} from '@api/integrations/storage/s3/libs/minio.server';
import { prismaRepository } from '@api/server.module';
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
const loginAttempts = new Map<string, { count: number; until: number }>();
const mediaExtensions = (extensions: string[]): Prisma.MediaWhereInput[] =>
  extensions.map((extension) => ({ fileName: { endsWith: `.${extension}`, mode: 'insensitive' } }));
const stickerFilter: Prisma.MediaWhereInput = { type: { in: ['sticker', 'stickerMessage'] } };
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
  if (principal.role !== 'admin' || !companyId)
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));

  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '50'), 10) || 50));
  const search = String(req.query.search || '').trim();
  const type = String(req.query.type || '').trim();
  const instanceId = String(req.query.instanceId || '').trim();
  const where: Prisma.MediaWhereInput = {
    Instance: { is: { companyId, ...(instanceId ? { id: instanceId } : {}) } },
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
    getCompanyStorageUsage(prismaRepository, companyId),
  ]);

  return res.json({ items, total, page, pageSize, ...usage });
});

router.get('/media/:mediaId/url', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const companyId = principal.companyId;
  if (principal.role !== 'admin' || !companyId)
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));
  const media = await prismaRepository.media.findFirst({
    where: { id: req.params.mediaId, Instance: { is: { companyId } } },
    select: { fileName: true, storageBackend: true, storageBucket: true },
  });
  if (!media) return res.status(404).json(fail('Arquivo não encontrado'));
  const companyTarget = await getCompanyStorageTargetById(prismaRepository, companyId);
  return res.json({ url: await getObjectUrl(media.fileName, undefined, getMediaStorageTarget(media, companyTarget)) });
});

router.delete('/media', async (req, res) => {
  const principal = getManagerPrincipal(req);
  const companyId = principal.companyId;
  if (principal.role !== 'admin' || !companyId)
    return res.status(403).json(fail('Acesso restrito ao administrador da empresa'));
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string')) {
    return res.status(400).json(fail('Selecione de 1 a 500 arquivos para excluir'));
  }

  const files = await prismaRepository.media.findMany({
    where: { id: { in: ids }, Instance: { is: { companyId } } },
    include: { Message: { select: { message: true } } },
  });
  const companyTarget = await getCompanyStorageTargetById(prismaRepository, companyId);
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

export const managerSaasRouter = router;
