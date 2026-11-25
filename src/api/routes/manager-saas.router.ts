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
import { scrypt as scryptCallback } from 'crypto';
import { Router } from 'express';
import { promisify } from 'util';

const router = Router();
const scrypt = promisify(scryptCallback);
const loginAttempts = new Map<string, { count: number; until: number }>();
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

router.get('/companies', async (req, res) => {
  const principal = getManagerPrincipal(req);
  if (principal.role === 'user') return res.status(403).json(fail('Acesso negado'));
  const companies = await prismaRepository.managerCompany.findMany({
    where: principal.role === 'superadmin' ? undefined : { id: principal.companyId },
    include: { _count: { select: { users: true, instances: true } } },
    orderBy: { name: 'asc' },
  });
  return res.json(companies);
});

router.post('/companies', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const name = String(req.body?.name || '').trim();
  const maxInstances = Number(req.body?.maxInstances);
  if (!name || name.length > 255 || !Number.isInteger(maxInstances) || maxInstances < 0) {
    return res.status(400).json(fail('Informe nome e limite de instâncias válido'));
  }
  const company = await prismaRepository.managerCompany.create({ data: { name, maxInstances } });
  return res.status(201).json(company);
});

router.patch('/companies/:companyId', async (req, res) => {
  if (getManagerPrincipal(req).role !== 'superadmin') return res.status(403).json(fail('Acesso negado'));
  const company = await prismaRepository.managerCompany.findUnique({ where: { id: req.params.companyId } });
  if (!company) return res.status(404).json(fail('Empresa não encontrada'));
  const name = req.body?.name === undefined ? company.name : String(req.body.name).trim();
  const maxInstances = req.body?.maxInstances === undefined ? company.maxInstances : Number(req.body.maxInstances);
  const active = req.body?.active === undefined ? company.active : req.body.active;
  if (
    !name ||
    name.length > 255 ||
    !Number.isInteger(maxInstances) ||
    maxInstances < company.instanceCount ||
    typeof active !== 'boolean'
  ) {
    return res.status(400).json(fail('Dados inválidos ou limite menor que as instâncias atribuídas'));
  }
  const updated = await prismaRepository.managerCompany.update({
    where: { id: company.id },
    data: { name, maxInstances, active },
  });
  return res.json(updated);
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
