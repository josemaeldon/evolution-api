import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import { instanceController, prismaRepository } from '@api/server.module';
import { getManagerPrincipal } from '@api/services/manager-saas.service';
import { ConfigService } from '@config/env.config';
import { instanceSchema, presenceOnlySchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class InstanceRouter extends RouterBroker {
  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.router
      .post('/create', ...guards, async (req, res) => {
        const principal = getManagerPrincipal(req);
        if (principal?.companyId) {
          const company = await prismaRepository.managerCompany.findUnique({ where: { id: principal.companyId } });
          if (!company?.active) return res.status(403).json({ error: 'Empresa inativa' });
          const reserved = await prismaRepository.managerCompany.updateMany({
            where: { id: company.id, instanceCount: { lt: company.maxInstances } },
            data: { instanceCount: { increment: 1 } },
          });
          if (!reserved.count) return res.status(409).json({ error: 'Limite de instâncias atingido' });
          try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => instanceController.createInstance(instance, company.id),
            });
            const stored = await prismaRepository.instance.findUnique({ where: { id: response.instance.instanceId } });
            if (stored?.companyId !== company.id) throw new Error('Instance was not saved for the company');
            return res.status(HttpStatus.CREATED).json(response);
          } catch (error) {
            const stored = await prismaRepository.instance.findUnique({
              where: { name: req.body?.instanceName || '' },
            });
            if (stored?.companyId !== company.id) {
              await prismaRepository.managerCompany.update({
                where: { id: company.id },
                data: { instanceCount: { decrement: 1 } },
              });
            }
            throw error;
          }
        }
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.createInstance(instance),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('restart'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.restartInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connect'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectToWhatsapp(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connectionState'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectionState(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchInstances', false), ...guards, async (req, res) => {
        const key = req.get('apikey');
        const principal = getManagerPrincipal(req);
        if (principal?.companyId) {
          const instances = await prismaRepository.instance.findMany({
            where: {
              companyId: principal.companyId,
              name: typeof req.query.instanceName === 'string' ? req.query.instanceName : undefined,
              id: typeof req.query.instanceId === 'string' ? req.query.instanceId : undefined,
            },
            include: {
              ...(principal.role === 'admin'
                ? {
                    Chatwoot: true,
                    Proxy: true,
                    Rabbitmq: true,
                    Nats: true,
                    Sqs: true,
                    Websocket: true,
                    Setting: true,
                  }
                : {}),
              _count: { select: { Message: true, Contact: true, Chat: true } },
            },
            orderBy: { name: 'asc' },
          });
          return res.status(HttpStatus.OK).json(
            instances.map((item) => ({
              ...item,
              token: principal.role === 'user' ? 'manager-session' : item.token,
            })),
          );
        }

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.fetchInstances(instance, key),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('setPresence'), ...guards, async (req, res) => {
        const response = await this.dataValidate<null>({
          request: req,
          schema: presenceOnlySchema,
          ClassRef: SetPresenceDto,
          execute: (instance, data) => instanceController.setPresence(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .delete(this.routerPath('logout'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.logout(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        const instance = await prismaRepository.instance.findUnique({ where: { name: req.params.instanceName } });
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.deleteInstance(instance),
        });

        if (instance?.companyId)
          await prismaRepository.managerCompany.update({
            where: { id: instance.companyId },
            data: { instanceCount: { decrement: 1 } },
          });

        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
