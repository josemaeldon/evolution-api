import { PrismaRepository } from '@api/repository/repository.service';
import { sessionPrincipal } from '@api/services/manager-saas.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Auth, configService, Cors, Log, Websocket } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { Request } from 'express';
import { Server } from 'http';
import { Server as SocketIO } from 'socket.io';

import { EmitData, EventController, EventControllerInterface } from '../event.controller';

export class WebsocketController extends EventController implements EventControllerInterface {
  private io: SocketIO;
  private corsConfig: Array<any>;
  private readonly logger = new Logger('WebsocketController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor, configService.get<Websocket>('WEBSOCKET')?.ENABLED, 'websocket');

    this.cors = configService.get<Cors>('CORS').ORIGIN;
  }

  public init(httpServer: Server): void {
    if (!this.status) {
      return;
    }

    this.socket = new SocketIO(httpServer, {
      cors: { origin: this.cors },
      allowRequest: async (req, callback) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const params = new URLSearchParams(url.search);

          const apiKey = params.get('apikey') || (req.headers.apikey as string);
          const globalToken = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
          if (apiKey && apiKey === globalToken) return callback(null, true);

          const manager = await sessionPrincipal(req as Request);
          if (manager?.companyId) {
            const origin = req.headers.origin;
            const host = req.headers.host;
            if (!origin || new URL(origin).host !== host) return callback('Invalid origin', false);
            const instanceName = params.get('instanceName');
            if (!instanceName) return callback('Instance required', false);
            const owned = await this.prismaRepository.instance.findFirst({
              where: { name: instanceName, companyId: manager.companyId },
              select: { id: true },
            });
            if (!owned) return callback('Instance not allowed', false);
            return callback(null, true);
          }

          if (!apiKey) {
            this.logger.error('Connection rejected: apiKey not provided');
            return callback('apiKey is required', false);
          }

          const instance = await this.prismaRepository.instance.findFirst({ where: { token: apiKey } });

          if (!instance) {
            if (apiKey !== globalToken) {
              this.logger.error('Connection rejected: invalid global token');
              return callback('Invalid global token', false);
            }
          }

          callback(null, true);
        } catch (error) {
          this.logger.error('Authentication error:');
          this.logger.error(error);
          callback('Authentication error', false);
        }
      },
    });

    this.socket.use(async (socket, next) => {
      try {
        const apiKey = String(socket.handshake.query.apikey || socket.handshake.headers.apikey || '');
        const globalToken = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
        if (apiKey && apiKey === globalToken) {
          socket.data.legacyGlobal = true;
          return next();
        }
        const principal = await sessionPrincipal(socket.request as Request);
        if (principal?.companyId) {
          const instanceName = String(socket.handshake.query.instanceName || '');
          const owned = await this.prismaRepository.instance.findFirst({
            where: { name: instanceName, companyId: principal.companyId },
            select: { id: true },
          });
          if (!owned) return next(new Error('Instance not allowed'));
          socket.data.managerInstanceName = instanceName;
        } else {
          const instance = apiKey
            ? await this.prismaRepository.instance.findFirst({
                where: { token: apiKey },
                select: { name: true },
              })
            : null;
          if (!instance) return next(new Error('Invalid token'));
          socket.data.legacyInstanceName = instance.name;
        }
        next();
      } catch {
        next(new Error('Authentication error'));
      }
    });

    this.socket.of(/^\/[^/]+$/).use(async (socket, next) => {
      try {
        const apiKey = String(socket.handshake.query.apikey || socket.handshake.headers.apikey || '');
        const globalToken = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
        if (apiKey && apiKey === globalToken) return next();
        const instanceName = socket.nsp.name.slice(1);
        const instance = apiKey
          ? await this.prismaRepository.instance.findFirst({
              where: { name: instanceName, token: apiKey },
              select: { id: true },
            })
          : null;
        if (!instance) return next(new Error('Instance not allowed'));
        next();
      } catch {
        next(new Error('Authentication error'));
      }
    });

    this.socket.on('connection', (socket) => {
      if (socket.data.managerInstanceName) socket.join(`manager:${socket.data.managerInstanceName}`);
      else if (socket.data.legacyGlobal) socket.join('legacy-global');
      else if (socket.data.legacyInstanceName) socket.join(`legacy-instance:${socket.data.legacyInstanceName}`);
      this.logger.info('User connected');

      socket.on('disconnect', () => {
        this.logger.info('User disconnected');
      });

      socket.on('sendNode', async (data) => {
        if (!socket.data.legacyGlobal && socket.data.legacyInstanceName !== data?.instanceId) return;
        try {
          await this.waMonitor.waInstances[data.instanceId].baileysSendNode(data.stanza);
          this.logger.info('Node sent successfully');
        } catch (error) {
          this.logger.error('Error sending node:');
          this.logger.error(error);
        }
      });
    });

    this.logger.info('Socket.io initialized');
  }

  private set cors(cors: Array<any>) {
    this.corsConfig = cors;
  }

  private get cors(): string | Array<any> {
    return this.corsConfig?.includes('*') ? '*' : this.corsConfig;
  }

  private set socket(socket: SocketIO) {
    this.io = socket;
  }

  public get socket(): SocketIO {
    return this.io;
  }

  public async emit({
    instanceName,
    origin,
    event,
    data,
    serverUrl,
    dateTime,
    sender,
    apiKey,
    integration,
    extra,
  }: EmitData): Promise<void> {
    if (!this.status) {
      return;
    }

    const configEv = event.replace(/[.-]/gm, '_').toUpperCase();
    const logEnabled = configService.get<Log>('LOG').LEVEL.includes('WEBSOCKET');
    const message = {
      ...(extra ?? {}),
      event,
      instance: instanceName,
      data,
      server_url: serverUrl,
      date_time: dateTime,
      sender,
      apikey: apiKey,
    };

    this.socket.to(`manager:${instanceName}`).emit(event, { ...message, apikey: undefined });

    if (integration && !integration.includes('websocket')) {
      return;
    }

    if (configService.get<Websocket>('WEBSOCKET')?.GLOBAL_EVENTS) {
      this.socket.to('legacy-global').emit(event, message);
      this.socket.to(`legacy-instance:${instanceName}`).emit(event, message);

      if (logEnabled) {
        this.logger.log({ local: `${origin}.sendData-WebsocketGlobal`, ...message });
      }
    }

    try {
      const instance = await this.get(instanceName);

      if (!instance?.enabled) {
        return;
      }

      if (Array.isArray(instance?.events) && instance?.events.includes(configEv)) {
        this.socket.of(`/${instanceName}`).emit(event, message);

        if (logEnabled) {
          this.logger.log({ local: `${origin}.sendData-Websocket`, ...message });
        }
      }
    } catch (err) {
      if (logEnabled) {
        this.logger.log(err);
      }
    }
  }
}
