import { prismaRepository, waMonitor } from '@api/server.module';
import { Events } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';
import { Request } from 'express';

import { getManagerPrincipal } from './manager-saas.service';

export type ManagerSender = { id: string; name: string; signMessages: boolean };
type SentMessage = { key?: { id?: string; remoteJid?: string }; instanceId?: string; [key: string]: unknown };
const logger = new Logger('ManagerMessageService');
const recentSendRequests = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

export async function runIdempotentSend<T>(req: Request, execute: () => Promise<T>): Promise<T> {
  const requestId = req.body?.clientRequestId;
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    return execute();
  }

  const now = Date.now();
  for (const [key, entry] of recentSendRequests) {
    if (entry.expiresAt <= now) recentSendRequests.delete(key);
  }

  const principal = getManagerPrincipal(req);
  const key = `${req.params.instanceName}:${req.path}:${principal?.userId || 'api'}:${requestId}`;
  const existing = recentSendRequests.get(key);
  if (existing) return existing.promise as Promise<T>;

  const promise = Promise.resolve().then(execute);
  recentSendRequests.set(key, { promise, expiresAt: now + 10 * 60_000 });
  try {
    return await promise;
  } catch (error) {
    recentSendRequests.delete(key);
    throw error;
  }
}

export async function managerSender(req: Request): Promise<ManagerSender | null> {
  const principal = getManagerPrincipal(req);
  if (!principal?.userId || !principal.companyId) return null;
  return prismaRepository.managerUser.findFirst({
    where: { id: principal.userId, companyId: principal.companyId, active: true },
    select: { id: true, name: true, signMessages: true },
  });
}

export function signedText(name: string, text: string): string {
  const safeName = name
    .replace(/[\r\n*_~`]/g, ' ')
    .trim()
    .slice(0, 100);
  return `*${safeName}:*\n${text}`;
}

export async function recordManagerSender(
  instanceName: string,
  response: SentMessage,
  sender: ManagerSender | null,
  signed: boolean,
): Promise<SentMessage> {
  if (!sender || !response?.key?.id || !response.key.remoteJid || !response.instanceId) return response;
  try {
    const stored = await prismaRepository.message.findFirst({
      where: {
        instanceId: response.instanceId,
        AND: [
          { key: { path: ['id'], equals: response.key.id } },
          { key: { path: ['remoteJid'], equals: response.key.remoteJid } },
        ],
      },
      select: { id: true },
    });
    if (stored) {
      await prismaRepository.message.update({
        where: { id: stored.id },
        data: { managerSenderId: sender.id, managerSenderName: sender.name, managerSigned: signed },
      });
    }
  } catch (error) {
    logger.error(`Could not save manager sender for an already sent message: ${String(error)}`);
  }
  const enriched = { ...response, managerSenderId: sender.id, managerSenderName: sender.name, managerSigned: signed };
  try {
    await waMonitor.waInstances[instanceName]?.sendDataWebhook(Events.SEND_MESSAGE, enriched, true, ['websocket']);
  } catch (error) {
    logger.error(`Could not publish manager sender for an already sent message: ${String(error)}`);
  }
  return enriched;
}

export async function recordManagerRequest(req: Request, response: SentMessage): Promise<SentMessage> {
  return recordManagerSender(req.params.instanceName, response, await managerSender(req), false);
}
