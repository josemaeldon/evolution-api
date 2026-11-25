import { prismaRepository } from '@api/server.module';
import { Auth, configService } from '@config/env.config';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'cloudbr_manager_session';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ManagerPrincipal = {
  role: 'superadmin' | 'admin' | 'user';
  companyId?: string;
  userId?: string;
};

type ManagerRequest = Request & { managerPrincipal?: ManagerPrincipal };

export function globalManagerKey(req: Request): boolean {
  const configured = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
  return !!configured && req.get('apikey') === configured;
}

export function getManagerPrincipal(req: Request): ManagerPrincipal | undefined {
  return (req as ManagerRequest).managerPrincipal;
}

export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expected] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected || expected.length !== 128) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function setSessionCookie(res: Response, token: string, req: Request) {
  const configuredUrl = String(configService.get('SERVER').URL || '');
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: configuredUrl.startsWith('https://') || req.secure || req.get('x-forwarded-proto') === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_AGE_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function sessionToken(req: Request): string | undefined {
  const header = req.get?.('cookie') || req.headers?.cookie || '';
  const part = header
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!part) return undefined;
  try {
    return decodeURIComponent(part.slice(COOKIE_NAME.length + 1));
  } catch {
    return undefined;
  }
}

export async function sessionPrincipal(req: Request): Promise<ManagerPrincipal | undefined> {
  const token = sessionToken(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await prismaRepository.managerSession.findUnique({
    where: { tokenHash },
    include: { user: { include: { company: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active || !session.user.company.active)
    return undefined;
  if (session.user.role !== 'admin' && session.user.role !== 'user') return undefined;
  return { role: session.user.role, companyId: session.user.companyId, userId: session.userId };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await prismaRepository.managerSession.create({
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      expiresAt: new Date(Date.now() + SESSION_AGE_MS),
    },
  });
  return token;
}

export async function deleteSession(req: Request): Promise<void> {
  const token = sessionToken(req);
  if (token) {
    await prismaRepository.managerSession.deleteMany({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
  }
}

export function sameOrigin(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const protocol = req.get('x-forwarded-proto')?.split(',')[0] || req.protocol;
    return source.host === req.get('host') && source.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export function setManagerPrincipal(req: Request, principal: ManagerPrincipal): void {
  (req as ManagerRequest).managerPrincipal = principal;
}
