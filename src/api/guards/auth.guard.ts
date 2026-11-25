import { InstanceDto } from '@api/dto/instance.dto';
import { prismaRepository } from '@api/server.module';
import { sameOrigin, sessionPrincipal, setManagerPrincipal } from '@api/services/manager-saas.service';
import { Auth, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('GUARD');
const USER_CHAT_ACTIONS = new Set([
  'whatsappNumbers',
  'markMessageAsRead',
  'archiveChat',
  'markChatUnread',
  'deleteMessageForEveryone',
  'forwardMessage',
  'fetchProfilePictureUrl',
  'getBase64FromMediaMessage',
  'updateMessage',
  'sendPresence',
  'findContacts',
  'saveContact',
  'deleteContact',
  'deleteConversation',
  'findMessages',
  'findChats',
  'findChatByRemoteJid',
  'fetchBusinessProfile',
  'fetchProfile',
]);

async function apikey(req: Request, _: Response, next: NextFunction) {
  const env = configService.get<Auth>('AUTHENTICATION').API_KEY;
  const key = req.get('apikey');
  if (key && env.KEY === key) return next();

  const principal = await sessionPrincipal(req);
  if (principal) {
    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      throw new ForbiddenException('Origem inválida');
    }
    if (req.method !== 'GET' && !sameOrigin(req)) throw new ForbiddenException('Origem inválida');
    setManagerPrincipal(req, principal);
    const path = req.originalUrl.split('?')[0];
    if (path === '/instance/fetchInstances') return next();
    if (path === '/instance/create') {
      if (principal.role !== 'admin') throw new ForbiddenException('Acesso restrito ao administrador');
      return next();
    }
    if (principal.role === 'user') {
      const [, area, action] = path.split('/');
      if (
        (area === 'chat' && !USER_CHAT_ACTIONS.has(action)) ||
        (area === 'message' && action === 'sendStatus') ||
        (area === 'pix' && action !== 'create') ||
        !['chat', 'message', 'pix', 'forms'].includes(area)
      ) {
        throw new ForbiddenException('Acesso restrito ao chat');
      }
    }
    const instanceName = req.params?.instanceName;
    if (!instanceName) throw new ForbiddenException('Instância não informada');
    const owned = await prismaRepository.instance.findFirst({
      where: { name: instanceName, companyId: principal.companyId },
      select: { id: true },
    });
    if (!owned) throw new ForbiddenException('Instância fora da sua empresa');
    return next();
  }
  const db = configService.get<Database>('DATABASE');

  if (!key) {
    throw new UnauthorizedException();
  }

  if ((req.originalUrl.includes('/instance/create') || req.originalUrl.includes('/instance/fetchInstances')) && !key) {
    throw new ForbiddenException('Missing global api key', 'The global api key must be set');
  }
  const param = req.params as unknown as InstanceDto;

  try {
    if (param?.instanceName) {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: param.instanceName },
      });
      if (instance.token === key) {
        return next();
      }
    } else {
      if (req.originalUrl.includes('/instance/fetchInstances') && db.SAVE_DATA.INSTANCE) {
        const instanceByKey = await prismaRepository.instance.findFirst({
          where: { token: key },
        });
        if (instanceByKey) {
          return next();
        }
      }
    }
  } catch (error) {
    logger.error(error);
  }

  throw new UnauthorizedException();
}

export const authGuard = { apikey };
