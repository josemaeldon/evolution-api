import { getCollectionsDto } from '@api/dto/business.dto';
import { OfferCallDto } from '@api/dto/call.dto';
import {
  ArchiveChatDto,
  BlockUserDto,
  DeleteMessage,
  ForwardMessageDto,
  getBase64FromMediaMessageDto,
  LastMessage,
  MarkChatUnreadDto,
  NumberBusiness,
  OnWhatsAppDto,
  PrivacySettingDto,
  ReadMessageDto,
  SendPresenceDto,
  SubscribePresenceDto,
  UpdateMessageDto,
  WhatsAppNumberDto,
} from '@api/dto/chat.dto';
import {
  AcceptGroupInvite,
  CreateGroupDto,
  GetParticipant,
  GroupDescriptionDto,
  GroupInvite,
  GroupJid,
  GroupPictureDto,
  GroupSendInvite,
  GroupSubjectDto,
  GroupToggleEphemeralDto,
  GroupUpdateParticipantDto,
  GroupUpdateSettingDto,
} from '@api/dto/group.dto';
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import { HandleLabelDto, LabelDto } from '@api/dto/label.dto';
import {
  Button,
  ContactMessage,
  KeyType,
  MediaMessage,
  Options,
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStatusDto,
  SendStickerDto,
  SendTextDto,
  StatusMessage,
  TypeButton,
} from '@api/dto/sendMessage.dto';
import { chatwootImport } from '@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper';
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { ProviderFiles } from '@api/provider/sessions';
import { PrismaRepository, Query } from '@api/repository/repository.service';
import { chatbotController, waMonitor } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { getCompanyStorageTarget, hasCompanyStorageCapacity } from '@api/services/manager-storage.service';
import { Events, MessageSubtype, TypeMediaMessage, wa } from '@api/types/wa.types';
import { CacheEngine } from '@cache/cacheengine';
import {
  AudioConverter,
  CacheConf,
  Chatwoot,
  ConfigService,
  configService,
  ConfigSessionPhone,
  Database,
  Log,
  Openai,
  ProviderSession,
  QrCode,
  S3,
} from '@config/env.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { Boom } from '@hapi/boom';
import { createId as cuid } from '@paralleldrive/cuid2';
import { Instance, Message } from '@prisma/client';
import { buttonFallbackText } from '@utils/buttonFallbackText';
import { createJid } from '@utils/createJid';
import { fetchLatestWaWebVersion } from '@utils/fetchLatestWaWebVersion';
import { makeProxyAgent, makeProxyAgentUndici } from '@utils/makeProxyAgent';
import { getOnWhatsappCache, saveOnWhatsappCache } from '@utils/onWhatsappCache';
import { status } from '@utils/renderStatus';
import { sendTelemetry } from '@utils/sendTelemetry';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
import axios from 'axios';
import makeWASocket, {
  AnyMessageContent,
  BinaryNode,
  BufferedEventData,
  BufferJSON,
  CacheStore,
  CatalogCollection,
  Chat,
  ConnectionState,
  Contact,
  decryptPollVote,
  delay,
  DisconnectReason,
  downloadContentFromMessage,
  downloadMediaMessage,
  generateWAMessageFromContent,
  getAggregateVotesInPollMessage,
  GetCatalogOptions,
  getContentType,
  getDevice,
  GroupMetadata,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  MessageUpsertType,
  MessageUserReceiptUpdate,
  MiscMessageGenerationOptions,
  normalizeMessageContent,
  ParticipantAction,
  prepareWAMessageMedia,
  Product,
  proto,
  UserFacingSocketConfig,
  WABrowserDescription,
  WAMediaUpload,
  WAMessage,
  WAMessageKey,
  WAPresence,
  WASocket,
} from 'baileys';
import { Label } from 'baileys/lib/Types/Label';
import { LabelAssociation } from 'baileys/lib/Types/LabelAssociation';
import { spawn } from 'child_process';
import { isArray, isBase64, isURL } from 'class-validator';
import { createDecipheriv, createHash, createHmac } from 'crypto';
import EventEmitter2 from 'eventemitter2';
import ffmpeg from 'fluent-ffmpeg';
import FormData from 'form-data';
import Long from 'long';
import mimeTypes from 'mime-types';
import NodeCache from 'node-cache';
import cron from 'node-cron';
import { release } from 'os';
import { join } from 'path';
import P from 'pino';
import qrcode, { QRCodeToDataURLOptions } from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import sharp from 'sharp';
import { PassThrough, Readable } from 'stream';
import { v4 } from 'uuid';

import { BaileysMessageProcessor } from './baileysMessage.processor';
import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys';

export interface ExtendedIMessageKey extends proto.IMessageKey {
  remoteJidAlt?: string;
  participantAlt?: string;
  server_id?: string;
  isViewOnce?: boolean;
}

const groupMetadataCache = new CacheService(new CacheEngine(configService, 'groups').getEngine());

// Adicione a função getVideoDuration no início do arquivo
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> {
  const MediaInfoFactory = (await import('mediainfo.js')).default;
  const mediainfo = await MediaInfoFactory({ format: 'JSON' });

  let fileSize: number;
  let readChunk: (size: number, offset: number) => Promise<Buffer>;

  if (Buffer.isBuffer(input)) {
    fileSize = input.length;
    readChunk = async (size: number, offset: number): Promise<Buffer> => {
      return input.slice(offset, offset + size);
    };
  } else if (typeof input === 'string') {
    const fs = await import('fs');
    const stat = await fs.promises.stat(input);
    fileSize = stat.size;
    const fd = await fs.promises.open(input, 'r');

    readChunk = async (size: number, offset: number): Promise<Buffer> => {
      const buffer = Buffer.alloc(size);
      await fd.read(buffer, 0, size, offset);
      return buffer;
    };

    try {
      const result = await mediainfo.analyzeData(() => fileSize, readChunk);
      const jsonResult = JSON.parse(result);

      const generalTrack = jsonResult.media.track.find((t: any) => t['@type'] === 'General');
      const duration = generalTrack.Duration;

      return Math.round(parseFloat(duration));
    } finally {
      await fd.close();
    }
  } else if (input instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    fileSize = data.length;

    readChunk = async (size: number, offset: number): Promise<Buffer> => {
      return data.slice(offset, offset + size);
    };
  } else {
    throw new Error('Tipo de entrada não suportado');
  }

  const result = await mediainfo.analyzeData(() => fileSize, readChunk);
  const jsonResult = JSON.parse(result);

  const generalTrack = jsonResult.media.track.find((t: any) => t['@type'] === 'General');
  const duration = generalTrack.Duration;

  return Math.round(parseFloat(duration));
}

export class BaileysStartupService extends ChannelStartupService {
  private messageProcessor = new BaileysMessageProcessor();

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles,
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache);
    this.instance.qrcode = { count: 0 };
    this.messageProcessor.mount({
      onMessageReceive: this.messageHandle['messages.upsert'].bind(this), // Bind the method to the current context
    });

    this.authStateProvider = new AuthStateProvider(this.providerFiles);
  }

  private authStateProvider: AuthStateProvider;
  private readonly msgRetryCounterCache: CacheStore = new NodeCache();
  private readonly userDevicesCache: CacheStore = new NodeCache({ stdTTL: 300000, useClones: false });
  private endSession = false;
  private logBaileys = this.configService.get<Log>('LOG').BAILEYS;
  private eventProcessingQueue: Promise<void> = Promise.resolve();
  private readonly groupNameLookupRetryAt = new Map<string, number>();

  // Cache TTL constants (in seconds)
  private readonly MESSAGE_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes - avoid duplicate message processing
  private readonly UPDATE_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes - avoid duplicate status updates

  public stateConnection: wa.StateConnection = { state: 'close' };

  public phoneNumber: string;

  public get connectionStatus() {
    return this.stateConnection;
  }

  public async logoutInstance() {
    this.messageProcessor.onDestroy();
    await this.client?.logout('Log out instance: ' + this.instanceName);

    this.client?.ws?.close();

    const db = this.configService.get<Database>('DATABASE');
    const cache = this.configService.get<CacheConf>('CACHE');
    const provider = this.configService.get<ProviderSession>('PROVIDER');

    if (provider?.ENABLED) {
      const authState = await this.authStateProvider.authStateProvider(this.instance.id);

      await authState.removeCreds();
    }

    if (cache?.REDIS.ENABLED && cache?.REDIS.SAVE_INSTANCES) {
      const authState = await useMultiFileAuthStateRedisDb(this.instance.id, this.cache);

      await authState.removeCreds();
    }

    if (db.SAVE_DATA.INSTANCE) {
      const authState = await useMultiFileAuthStatePrisma(this.instance.id, this.cache);

      await authState.removeCreds();
    }

    const sessionExists = await this.prismaRepository.session.findFirst({ where: { sessionId: this.instanceId } });
    if (sessionExists) {
      await this.prismaRepository.session.delete({ where: { sessionId: this.instanceId } });
    }
  }

  public async getProfileName() {
    let profileName = this.client.user?.name ?? this.client.user?.verifiedName;
    if (!profileName) {
      const data = await this.prismaRepository.session.findUnique({ where: { sessionId: this.instanceId } });

      if (data) {
        const creds = JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver);
        profileName = creds.me?.name || creds.me?.verifiedName;
      }
    }

    return profileName;
  }

  public async getProfileStatus() {
    const status = await this.client.fetchStatus(this.instance.wuid);

    return status[0]?.status;
  }

  public get profilePictureUrl() {
    return this.instance.profilePictureUrl;
  }

  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count,
    };
  }

  private async connectionUpdate({ qr, connection, lastDisconnect }: Partial<ConnectionState>) {
    if (qr) {
      if (this.instance.qrcode.count === this.configService.get<QrCode>('QRCODE').LIMIT) {
        this.sendDataWebhook(Events.QRCODE_UPDATED, {
          message: 'QR code limit reached, please login again',
          statusCode: DisconnectReason.badSession,
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          this.chatwootService.eventWhatsapp(
            Events.QRCODE_UPDATED,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            { message: 'QR code limit reached, please login again', statusCode: DisconnectReason.badSession },
          );
        }

        this.sendDataWebhook(Events.CONNECTION_UPDATE, {
          instance: this.instance.name,
          state: 'refused',
          statusReason: DisconnectReason.connectionClosed,
          wuid: this.instance.wuid,
          profileName: await this.getProfileName(),
          profilePictureUrl: this.instance.profilePictureUrl,
        });

        this.endSession = true;

        return this.eventEmitter.emit('no.connection', this.instance.name);
      }

      this.instance.qrcode.count++;

      const color = this.configService.get<QrCode>('QRCODE').COLOR;

      const optsQrcode: QRCodeToDataURLOptions = {
        margin: 3,
        scale: 4,
        errorCorrectionLevel: 'H',
        color: { light: '#ffffff', dark: color },
      };

      if (this.phoneNumber) {
        await delay(1000);
        this.instance.qrcode.pairingCode = await this.client.requestPairingCode(this.phoneNumber);
      } else {
        this.instance.qrcode.pairingCode = null;
      }

      qrcode.toDataURL(qr, optsQrcode, (error, base64) => {
        if (error) {
          this.logger.error('Qrcode generate failed:' + error.toString());
          return;
        }

        this.instance.qrcode.base64 = base64;
        this.instance.qrcode.code = qr;

        this.sendDataWebhook(Events.QRCODE_UPDATED, {
          qrcode: { instance: this.instance.name, pairingCode: this.instance.qrcode.pairingCode, code: qr, base64 },
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          this.chatwootService.eventWhatsapp(
            Events.QRCODE_UPDATED,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            {
              qrcode: { instance: this.instance.name, pairingCode: this.instance.qrcode.pairingCode, code: qr, base64 },
            },
          );
        }
      });

      qrcodeTerminal.generate(qr, { small: true }, (qrcode) =>
        this.logger.log(
          `\n{ instance: ${this.instance.name} pairingCode: ${this.instance.qrcode.pairingCode}, qrcodeCount: ${this.instance.qrcode.count} }\n` +
            qrcode,
        ),
      );

      await this.prismaRepository.instance.update({
        where: { id: this.instanceId },
        data: { connectionStatus: 'connecting' },
      });
    }

    if (connection) {
      this.stateConnection = {
        state: connection,
        statusReason: (lastDisconnect?.error as Boom)?.output?.statusCode ?? 200,
      };
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const codesToNotReconnect = [DisconnectReason.loggedOut, DisconnectReason.forbidden, 402, 406];
      const shouldReconnect = !codesToNotReconnect.includes(statusCode);
      if (shouldReconnect) {
        await this.connectToWhatsapp(this.phoneNumber);
      } else {
        this.sendDataWebhook(Events.STATUS_INSTANCE, {
          instance: this.instance.name,
          status: 'closed',
          disconnectionAt: new Date(),
          disconnectionReasonCode: statusCode,
          disconnectionObject: JSON.stringify(lastDisconnect),
        });

        await this.prismaRepository.instance.update({
          where: { id: this.instanceId },
          data: {
            connectionStatus: 'close',
            disconnectionAt: new Date(),
            disconnectionReasonCode: statusCode,
            disconnectionObject: JSON.stringify(lastDisconnect),
          },
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          this.chatwootService.eventWhatsapp(
            Events.STATUS_INSTANCE,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            { instance: this.instance.name, status: 'closed' },
          );
        }

        this.eventEmitter.emit('logout.instance', this.instance.name, 'inner');
        this.client?.ws?.close();
        this.client.end(new Error('Close connection'));

        this.sendDataWebhook(Events.CONNECTION_UPDATE, { instance: this.instance.name, ...this.stateConnection });
      }
    }

    if (connection === 'open') {
      this.instance.wuid = this.client.user.id.replace(/:\d+/, '');
      try {
        const profilePic = await this.profilePicture(this.instance.wuid);
        this.instance.profilePictureUrl = profilePic.profilePictureUrl;
      } catch {
        this.instance.profilePictureUrl = null;
      }
      const formattedWuid = this.instance.wuid.split('@')[0].padEnd(30, ' ');
      const formattedName = this.instance.name;
      this.logger.info(
        `
        ┌──────────────────────────────┐
        │    CONNECTED TO WHATSAPP     │
        └──────────────────────────────┘`.replace(/^ +/gm, '  '),
      );
      this.logger.info(
        `
        wuid: ${formattedWuid}
        name: ${formattedName}
      `,
      );

      await this.prismaRepository.instance.update({
        where: { id: this.instanceId },
        data: {
          ownerJid: this.instance.wuid,
          profileName: (await this.getProfileName()) as string,
          profilePicUrl: this.instance.profilePictureUrl,
          connectionStatus: 'open',
        },
      });

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
        this.chatwootService.eventWhatsapp(
          Events.CONNECTION_UPDATE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          { instance: this.instance.name, status: 'open' },
        );
        this.syncChatwootLostMessages();
      }

      this.sendDataWebhook(Events.CONNECTION_UPDATE, {
        instance: this.instance.name,
        wuid: this.instance.wuid,
        profileName: await this.getProfileName(),
        profilePictureUrl: this.instance.profilePictureUrl,
        ...this.stateConnection,
      });
    }

    if (connection === 'connecting') {
      this.sendDataWebhook(Events.CONNECTION_UPDATE, { instance: this.instance.name, ...this.stateConnection });
    }
  }

  private async getMessage(key: proto.IMessageKey, full = false) {
    try {
      // Use raw SQL to avoid JSON path issues
      const webMessageInfo = (await this.prismaRepository.$queryRaw`
        SELECT * FROM "Message"
        WHERE "instanceId" = ${this.instanceId}
        AND "key"->>'id' = ${key.id}
      `) as proto.IWebMessageInfo[];

      if (full) {
        return webMessageInfo[0];
      }
      if (webMessageInfo[0].message?.pollCreationMessage) {
        const messageSecretBase64 = webMessageInfo[0].message?.messageContextInfo?.messageSecret;

        if (typeof messageSecretBase64 === 'string') {
          const messageSecret = Buffer.from(messageSecretBase64, 'base64');

          const msg = {
            messageContextInfo: { messageSecret },
            pollCreationMessage: webMessageInfo[0].message?.pollCreationMessage,
          };

          return msg;
        }
      }

      return webMessageInfo[0].message;
    } catch {
      return { conversation: '' };
    }
  }

  private async decryptSecretEncryptedMessageEdit(message: proto.IWebMessageInfo) {
    const encrypted = message.message?.secretEncryptedMessage;
    const targetKey = encrypted?.targetMessageKey;
    if (
      !encrypted ||
      encrypted.secretEncType !== proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT ||
      !targetKey?.id
    ) {
      throw new Error('Unsupported encrypted message edit');
    }

    const original = (await this.getMessage(targetKey, true)) as any;
    const rawSecret = original?.message?.messageContextInfo?.messageSecret;
    const messageSecret = this.secretMessageBytes(rawSecret);
    const encPayload = this.secretMessageBytes(encrypted.encPayload);
    const encIv = this.secretMessageBytes(encrypted.encIv);
    if (
      !messageSecret ||
      messageSecret.length !== 32 ||
      !encPayload ||
      encPayload.length < 17 ||
      !encIv ||
      encIv.length !== 12
    ) {
      throw new Error('Encrypted edit is missing valid key material');
    }

    const messageKey = message.key as any;
    const senderCandidates = new Set<string>(
      [
        messageKey?.participant,
        messageKey?.participantAlt,
        messageKey?.remoteJid,
        messageKey?.remoteJidAlt,
        (message as any).participant,
        this.instance.wuid,
        this.client.user?.lid,
      ].filter((jid): jid is string => typeof jid === 'string' && jid.length > 0),
    );
    for (const jid of [...senderCandidates]) {
      try {
        const mappedJid = jid.endsWith('@lid')
          ? await this.client.signalRepository.lidMapping.getPNForLID(jid)
          : await this.client.signalRepository.lidMapping.getLIDForPN(jid);
        if (mappedJid) senderCandidates.add(mappedJid);
      } catch {
        // Keep trying the JIDs already present on the message.
      }
    }

    const key0 = createHmac('sha256', Buffer.alloc(32)).update(messageSecret).digest();
    for (const sender of senderCandidates) {
      const sign = Buffer.concat([
        Buffer.from(targetKey.id),
        Buffer.from(sender),
        Buffer.from(sender),
        Buffer.from('Message Edit'),
        Buffer.from([1]),
      ]);
      const decryptionKey = createHmac('sha256', key0).update(sign).digest();
      try {
        const decipher = createDecipheriv('aes-256-gcm', decryptionKey, encIv);
        decipher.setAuthTag(encPayload.subarray(encPayload.length - 16));
        const plaintext = Buffer.concat([
          decipher.update(encPayload.subarray(0, encPayload.length - 16)),
          decipher.final(),
        ]);
        const decoded = proto.Message.decode(plaintext);
        const edit = decoded.protocolMessage;
        if (edit?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && edit.editedMessage) {
          return edit;
        }
      } catch {
        // A different LID/phone-number representation may be the authenticated sender.
      }
    }
    throw new Error('Unable to authenticate encrypted message edit');
  }

  private secretMessageBytes(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return Buffer.from(value);
    }
    if (typeof value === 'string') {
      try {
        return Buffer.from(value, 'base64');
      } catch {
        return null;
      }
    }
    if (value && typeof value === 'object') {
      const object = value as { type?: unknown; data?: unknown } & Record<string, unknown>;
      if (object.type === 'Buffer' && Array.isArray(object.data)) return this.secretMessageBytes(object.data);
      const indexes = Object.keys(object)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b));
      if (indexes.length) return Buffer.from(indexes.map((key) => Number(object[key])));
    }
    return null;
  }

  private async defineAuthState() {
    const db = this.configService.get<Database>('DATABASE');
    const cache = this.configService.get<CacheConf>('CACHE');

    const provider = this.configService.get<ProviderSession>('PROVIDER');

    if (provider?.ENABLED) {
      return await this.authStateProvider.authStateProvider(this.instance.id);
    }

    if (cache?.REDIS.ENABLED && cache?.REDIS.SAVE_INSTANCES) {
      this.logger.info('Redis enabled');
      return await useMultiFileAuthStateRedisDb(this.instance.id, this.cache);
    }

    if (db.SAVE_DATA.INSTANCE) {
      return await useMultiFileAuthStatePrisma(this.instance.id, this.cache);
    }
  }

  private async createClient(number?: string): Promise<WASocket> {
    this.instance.authState = await this.defineAuthState();

    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');

    let browserOptions = {};

    if (number || this.phoneNumber) {
      this.phoneNumber = number;

      this.logger.info(`Phone number: ${number}`);
    } else {
      const browser: WABrowserDescription = [session.CLIENT, session.NAME, release()];
      browserOptions = { browser };

      this.logger.info(`Browser: ${browser}`);
    }

    const baileysVersion = await fetchLatestWaWebVersion({});
    const version = baileysVersion.version;
    const log = `Baileys version: ${version.join('.')}`;

    this.logger.info(log);

    this.logger.info(`Group Ignore: ${this.localSettings.groupsIgnore}`);

    let options;

    if (this.localProxy?.enabled) {
      this.logger.info('Proxy enabled: ' + this.localProxy?.host);

      if (this.localProxy?.host?.includes('proxyscrape')) {
        try {
          const response = await axios.get(this.localProxy?.host);
          const text = response.data;
          const proxyUrls = text.split('\r\n');
          const rand = Math.floor(Math.random() * Math.floor(proxyUrls.length));
          const proxyUrl = 'http://' + proxyUrls[rand];
          options = { agent: makeProxyAgent(proxyUrl), fetchAgent: makeProxyAgentUndici(proxyUrl) };
        } catch {
          this.localProxy.enabled = false;
        }
      } else {
        options = {
          agent: makeProxyAgent({
            host: this.localProxy.host,
            port: this.localProxy.port,
            protocol: this.localProxy.protocol,
            username: this.localProxy.username,
            password: this.localProxy.password,
          }),
          fetchAgent: makeProxyAgentUndici({
            host: this.localProxy.host,
            port: this.localProxy.port,
            protocol: this.localProxy.protocol,
            username: this.localProxy.username,
            password: this.localProxy.password,
          }),
        };
      }
    }

    const socketConfig: UserFacingSocketConfig = {
      ...options,
      version,
      logger: P({ level: this.logBaileys }),
      printQRInTerminal: false,
      auth: {
        creds: this.instance.authState.state.creds,
        keys: makeCacheableSignalKeyStore(this.instance.authState.state.keys, P({ level: 'error' }) as any),
      },
      msgRetryCounterCache: this.msgRetryCounterCache,
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => (await this.getMessage(key)) as Promise<proto.IMessage>,
      ...browserOptions,
      markOnlineOnConnect: this.localSettings.alwaysOnline,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 4,
      fireInitQueries: true,
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 30_000,
      qrTimeout: 45_000,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid) => {
        if (this.localSettings.syncFullHistory && isJidGroup(jid)) {
          return false;
        }

        const isGroupJid = this.localSettings.groupsIgnore && isJidGroup(jid);
        const isNewsletter = isJidNewsletter(jid);

        return isGroupJid || isNewsletter;
      },
      syncFullHistory: this.localSettings.syncFullHistory,
      shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification) => {
        return this.historySyncNotification(msg);
      },
      cachedGroupMetadata: this.getGroupMetadataCache,
      userDevicesCache: this.userDevicesCache,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
      patchMessageBeforeSending(message) {
        if (
          message.deviceSentMessage?.message?.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST
        ) {
          message = JSON.parse(JSON.stringify(message));

          message.deviceSentMessage.message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
        }

        if (message.listMessage?.listType == proto.Message.ListMessage.ListType.PRODUCT_LIST) {
          message = JSON.parse(JSON.stringify(message));

          message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
        }

        return message;
      },
    };

    this.endSession = false;

    this.client = makeWASocket(socketConfig);

    if (this.localSettings.wavoipToken && this.localSettings.wavoipToken.length > 0) {
      useVoiceCallsBaileys(this.localSettings.wavoipToken, this.client, this.connectionStatus.state as any, true);
    }

    this.eventHandler();

    this.client.ws.on('CB:call', (packet) => {
      console.log('CB:call', packet);
      const payload = { event: 'CB:call', packet: packet };
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });

    this.client.ws.on('CB:ack,class:call', (packet) => {
      console.log('CB:ack,class:call', packet);
      const payload = { event: 'CB:ack,class:call', packet: packet };
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });

    this.phoneNumber = number;

    return this.client;
  }

  public async connectToWhatsapp(number?: string): Promise<WASocket> {
    try {
      this.loadChatwoot();
      this.loadSettings();
      this.loadWebhook();
      this.loadProxy();

      // Remontar o messageProcessor para garantir que está funcionando após reconexão
      this.messageProcessor.mount({
        onMessageReceive: this.messageHandle['messages.upsert'].bind(this),
      });

      return await this.createClient(number);
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }

  public async reloadConnection(): Promise<WASocket> {
    try {
      return await this.createClient(this.phoneNumber);
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }

  private readonly chatHandle = {
    'chats.upsert': async (chats: Chat[]) => {
      const existingChatIds = await this.prismaRepository.chat.findMany({
        where: { instanceId: this.instanceId },
        select: { remoteJid: true },
      });

      const existingChatIdSet = new Set(existingChatIds.map((chat) => chat.remoteJid));

      const chatsToInsert = chats
        .filter((chat) => !existingChatIdSet?.has(chat.id))
        .map((chat) => ({
          remoteJid: chat.id,
          instanceId: this.instanceId,
          name: chat.name,
          unreadMessages: chat.unreadCount !== undefined ? chat.unreadCount : 0,
        }));

      this.sendDataWebhook(Events.CHATS_UPSERT, chatsToInsert);

      if (chatsToInsert.length > 0) {
        if (this.configService.get<Database>('DATABASE').SAVE_DATA.CHATS)
          await this.prismaRepository.chat.createMany({ data: chatsToInsert, skipDuplicates: true });
      }
    },

    'chats.update': async (
      chats: Partial<
        proto.IConversation & { lastMessageRecvTimestamp?: number } & {
          conditional: (bufferedData: BufferedEventData) => boolean;
        }
      >[],
    ) => {
      const chatsRaw = chats.map((chat) => {
        return { remoteJid: chat.id, instanceId: this.instanceId };
      });

      this.sendDataWebhook(Events.CHATS_UPDATE, chatsRaw);

      for (const chat of chats) {
        await this.prismaRepository.chat.updateMany({
          where: { instanceId: this.instanceId, remoteJid: chat.id, name: chat.name },
          data: { remoteJid: chat.id },
        });
      }
    },

    'chats.delete': async (chats: string[]) => {
      chats.forEach(
        async (chat) =>
          await this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: chat } }),
      );

      this.sendDataWebhook(Events.CHATS_DELETE, [...chats]);
    },
  };

  private async syncContactNames(contacts: Partial<Contact>[]) {
    if (!this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS) return;
    // PUSH_NAME sync often contains LIDs only. Persist both identities before fetching any photos.
    for (let index = 0; index < contacts.length; index += 20) {
      await Promise.all(
        contacts.slice(index, index + 20).map(async (contact) => {
          if (!contact.id) return;
          const name = [contact.name, contact.notify, contact.verifiedName].find((value) =>
            this.isUsefulGroupSenderName(value),
          );
          if (!name) return;
          const normalizeJid = (jid: string) => jid.replace(/:\d+(?=@)/, '');
          const jids = new Set(
            [contact.id, contact.lid, contact.phoneNumber]
              .filter((jid): jid is string => Boolean(jid))
              .map((jid) => normalizeJid(jid.includes('@') ? jid : `${jid}@s.whatsapp.net`)),
          );
          for (const jid of [...jids]) {
            try {
              const mapping = this.client.signalRepository.lidMapping;
              const alias = jid.endsWith('@lid') ? await mapping.getPNForLID(jid) : await mapping.getLIDForPN(jid);
              if (alias) jids.add(normalizeJid(alias));
            } catch {
              // A name remains available under its original identity until an alias is known.
            }
          }
          await Promise.all(
            [...jids].map((remoteJid) =>
              this.prismaRepository.contact.upsert({
                where: { remoteJid_instanceId: { remoteJid, instanceId: this.instanceId } },
                create: { remoteJid, instanceId: this.instanceId, pushName: name.trim() },
                update: { pushName: name.trim() },
              }),
            ),
          );
        }),
      );
    }
  }

  private readonly contactHandle = {
    'contacts.upsert': async (contacts: Contact[]) => {
      try {
        await this.syncContactNames(contacts);
        const contactsRaw: any = contacts.map((contact) => ({
          remoteJid: contact.id,
          pushName: contact?.name || contact?.notify || contact?.verifiedName || contact.id.split('@')[0],
          profilePicUrl: null,
          instanceId: this.instanceId,
        }));

        if (contactsRaw.length > 0) {
          this.sendDataWebhook(Events.CONTACTS_UPSERT, contactsRaw);

          if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS)
            await this.prismaRepository.contact.createMany({ data: contactsRaw, skipDuplicates: true });

          const usersContacts = contactsRaw.filter((c) => c.remoteJid.includes('@s.whatsapp'));
          if (usersContacts) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
          }
        }

        if (
          this.configService.get<Chatwoot>('CHATWOOT').ENABLED &&
          this.localChatwoot?.enabled &&
          this.localChatwoot.importContacts &&
          contactsRaw.length
        ) {
          this.chatwootService.addHistoryContacts(
            { instanceName: this.instance.name, instanceId: this.instance.id },
            contactsRaw,
          );
          chatwootImport.importHistoryContacts(
            { instanceName: this.instance.name, instanceId: this.instance.id },
            this.localChatwoot,
          );
        }

        const updatedContacts = await Promise.all(
          contacts.map(async (contact) => ({
            remoteJid: contact.id,
            pushName: contact?.name || contact?.notify || contact?.verifiedName || contact.id.split('@')[0],
            profilePicUrl: (await this.profilePicture(contact.id)).profilePictureUrl,
            instanceId: this.instanceId,
          })),
        );

        if (updatedContacts.length > 0) {
          const usersContacts = updatedContacts.filter((c) => c.remoteJid.includes('@s.whatsapp'));
          if (usersContacts) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
          }

          this.sendDataWebhook(Events.CONTACTS_UPDATE, updatedContacts);
          await Promise.all(
            updatedContacts.map(async (contact) => {
              if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS) {
                await this.prismaRepository.contact.updateMany({
                  where: { remoteJid: contact.remoteJid, instanceId: this.instanceId },
                  data: {
                    profilePicUrl: contact.profilePicUrl,
                    ...(!/^\+?\d[\d\s().:-]*$/.test(contact.pushName) ? { pushName: contact.pushName } : {}),
                  },
                });
              }

              if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
                const instance = { instanceName: this.instance.name, instanceId: this.instance.id };

                const findParticipant = await this.chatwootService.findContact(
                  instance,
                  contact.remoteJid.split('@')[0],
                );

                if (!findParticipant) {
                  return;
                }

                this.chatwootService.updateContact(instance, findParticipant.id, {
                  name: contact.pushName,
                  avatar_url: contact.profilePicUrl,
                });
              }
            }),
          );
        }
      } catch (error) {
        console.error(error);
        this.logger.error(`Error: ${error.message}`);
      }
    },

    'contacts.update': async (contacts: Partial<Contact>[]) => {
      await this.syncContactNames(contacts);
      const contactsRaw: { remoteJid: string; pushName?: string; profilePicUrl?: string; instanceId: string }[] = [];
      for await (const contact of contacts) {
        this.logger.debug(`Updating contact: ${JSON.stringify(contact, null, 2)}`);
        contactsRaw.push({
          remoteJid: contact.id,
          pushName: [contact?.name, contact?.notify, contact?.verifiedName].find((name) =>
            this.isUsefulGroupSenderName(name),
          ),
          profilePicUrl: (await this.profilePicture(contact.id)).profilePictureUrl,
          instanceId: this.instanceId,
        });
      }

      this.sendDataWebhook(Events.CONTACTS_UPDATE, contactsRaw);

      if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS) {
        const updateTransactions = contactsRaw.map((contact) =>
          this.prismaRepository.contact.upsert({
            where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
            create: contact,
            update: contact,
          }),
        );
        await this.prismaRepository.$transaction(updateTransactions);
      }

      //const usersContacts = contactsRaw.filter((c) => c.remoteJid.includes('@s.whatsapp'));
    },
  };

  private readonly messageHandle = {
    'messaging-history.set': async ({
      messages,
      chats,
      contacts,
      isLatest,
      progress,
      syncType,
    }: {
      chats: Chat[];
      contacts: Contact[];
      messages: WAMessage[];
      isLatest?: boolean;
      progress?: number;
      syncType?: proto.HistorySync.HistorySyncType;
    }) => {
      try {
        if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
          console.log('received on-demand history sync, messages=', messages);
        }
        console.log(
          `recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest}, progress: ${progress}%), type: ${syncType}`,
        );

        await this.contactHandle['contacts.upsert'](
          contacts.filter((contact) => contact.id && (contact.name || contact.notify || contact.verifiedName)),
        );
        if (!messages.length && !chats.length) return;

        const instance: InstanceDto = { instanceName: this.instance.name };

        let timestampLimitToImport = null;

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
          const daysLimitToImport = this.localChatwoot?.enabled ? this.localChatwoot.daysLimitImportMessages : 1000;

          const date = new Date();
          timestampLimitToImport = new Date(date.setDate(date.getDate() - daysLimitToImport)).getTime() / 1000;

          const maxBatchTimestamp = Math.max(...messages.map((message) => message.messageTimestamp as number));

          const processBatch = maxBatchTimestamp >= timestampLimitToImport;

          if (!processBatch) {
            return;
          }
        }

        const contactsMap = new Map();

        for (const contact of contacts) {
          if (contact.id && (contact.notify || contact.name)) {
            contactsMap.set(contact.id, { name: contact.name ?? contact.notify, jid: contact.id });
          }
        }

        const chatsRaw: { remoteJid: string; instanceId: string; name?: string }[] = [];
        const chatsRepository = new Set(
          (await this.prismaRepository.chat.findMany({ where: { instanceId: this.instanceId } })).map(
            (chat) => chat.remoteJid,
          ),
        );

        for (const chat of chats) {
          if (chatsRepository?.has(chat.id)) {
            continue;
          }

          chatsRaw.push({ remoteJid: chat.id, instanceId: this.instanceId, name: chat.name });
        }

        this.sendDataWebhook(Events.CHATS_SET, chatsRaw);

        if (this.configService.get<Database>('DATABASE').SAVE_DATA.HISTORIC) {
          await this.prismaRepository.chat.createMany({ data: chatsRaw, skipDuplicates: true });
        }

        const messagesRaw: any[] = [];
        const groupSendersWithPushName = new Map<string, WAMessage>();

        const messagesRepository: Set<string> = new Set(
          chatwootImport.getRepositoryMessagesCache(instance) ??
            (
              await this.prismaRepository.message.findMany({
                select: { key: true },
                where: { instanceId: this.instanceId },
              })
            ).map((message) => {
              const key = message.key as { id: string };

              return key.id;
            }),
        );

        if (chatwootImport.getRepositoryMessagesCache(instance) === null) {
          chatwootImport.setRepositoryMessagesCache(instance, messagesRepository);
        }

        for (const m of messages) {
          if (!m.message || !m.key || !m.messageTimestamp) {
            continue;
          }

          if (Long.isLong(m?.messageTimestamp)) {
            m.messageTimestamp = m.messageTimestamp?.toNumber();
          }

          if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
            if (m.messageTimestamp <= timestampLimitToImport) {
              continue;
            }
          }

          const participantJid = m.key.participant || m.key.participantAlt || m.participant;
          if (isJidGroup(m.key.remoteJid) && participantJid && this.isUsefulGroupSenderName(m.pushName)) {
            groupSendersWithPushName.set(participantJid, m);
          }

          if (messagesRepository?.has(m.key.id)) {
            continue;
          }

          if (!m.pushName && !m.key.fromMe) {
            const participantJid = m.participant || m.key.participant || m.key.remoteJid;
            if (participantJid && contactsMap.has(participantJid)) {
              m.pushName = contactsMap.get(participantJid).name;
            } else if (participantJid) {
              m.pushName = participantJid.split('@')[0];
            }
          }

          messagesRaw.push(this.prepareMessage(m));
        }

        this.sendDataWebhook(Events.MESSAGES_SET, [...messagesRaw], true, undefined, {
          isLatest,
          progress,
        });

        if (this.configService.get<Database>('DATABASE').SAVE_DATA.HISTORIC) {
          await this.prismaRepository.message.createMany({ data: messagesRaw, skipDuplicates: true });
        }

        const groupSenders = [...groupSendersWithPushName.values()];
        for (let index = 0; index < groupSenders.length; index += 20) {
          await Promise.all(
            groupSenders.slice(index, index + 20).map((message) => this.saveGroupSenderPushName(message)),
          );
        }

        if (
          this.configService.get<Chatwoot>('CHATWOOT').ENABLED &&
          this.localChatwoot?.enabled &&
          this.localChatwoot.importMessages &&
          messagesRaw.length > 0
        ) {
          this.chatwootService.addHistoryMessages(
            instance,
            messagesRaw.filter((msg) => !chatwootImport.isIgnorePhoneNumber(msg.key?.remoteJid)),
          );
        }

        contacts = undefined;
        messages = undefined;
        chats = undefined;
      } catch (error) {
        this.logger.error(error);
      }
    },

    'messages.upsert': async (
      { messages, type, requestId }: { messages: WAMessage[]; type: MessageUpsertType; requestId?: string },
      settings: any,
    ) => {
      try {
        for (const received of messages) {
          if (
            received?.messageStubParameters?.some?.((param) =>
              [
                'No matching sessions found for message',
                'Bad MAC',
                'failed to decrypt message',
                'SessionError',
                'Invalid PreKey ID',
                'No session record',
                'No session found to decrypt message',
                'Message absent from node',
              ].some((err) => param?.includes?.(err)),
            )
          ) {
            this.logger.warn(`Message ignored with messageStubParameters: ${JSON.stringify(received, null, 2)}`);
            continue;
          }
          if (received.message?.conversation || received.message?.extendedTextMessage?.text) {
            const text = received.message?.conversation || received.message?.extendedTextMessage?.text;

            if (text == 'requestPlaceholder' && !requestId) {
              const messageId = await this.client.requestPlaceholderResend(received.key);

              console.log('requested placeholder resync, id=', messageId);
            } else if (requestId) {
              console.log('Message received from phone, id=', requestId, received);
            }

            if (text == 'onDemandHistSync') {
              const messageId = await this.client.fetchMessageHistory(50, received.key, received.messageTimestamp!);
              console.log('requested on-demand sync, id=', messageId);
            }
          }

          let editedMessage =
            received?.message?.protocolMessage || received?.message?.editedMessage?.message?.protocolMessage;

          const secretEncryptedMessage = received?.message?.secretEncryptedMessage;
          if (secretEncryptedMessage) {
            if (
              secretEncryptedMessage.secretEncType === proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
            ) {
              try {
                editedMessage = await this.decryptSecretEncryptedMessageEdit(received);
              } catch (error) {
                this.logger.warn(
                  `Unable to decrypt encrypted message edit ${received.key?.id} for ${secretEncryptedMessage.targetMessageKey?.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }

            // Encrypted edit envelopes are not standalone messages and must never be stored as chat content.
            if (!editedMessage) continue;
          }

          if (editedMessage) {
            if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled)
              this.chatwootService.eventWhatsapp(
                'messages.edit',
                { instanceName: this.instance.name, instanceId: this.instance.id },
                editedMessage,
              );

            await this.sendDataWebhook(Events.MESSAGES_EDITED, editedMessage);

            if (received.key?.id && editedMessage.key?.id) {
              await this.baileysCache.set(`protocol_${received.key.id}`, editedMessage.key.id, 60 * 60 * 24);
            }

            const oldMessage = await this.getMessage(editedMessage.key, true);
            if ((oldMessage as any)?.id) {
              const editedMessageTimestamp = Long.isLong(received?.messageTimestamp)
                ? Math.floor(received?.messageTimestamp.toNumber())
                : Math.floor(received?.messageTimestamp as number);

              await this.prismaRepository.message.update({
                where: { id: (oldMessage as any).id },
                data: {
                  message: editedMessage.editedMessage as any,
                  messageTimestamp: editedMessageTimestamp,
                  status: 'EDITED',
                },
              });
              await this.prismaRepository.messageUpdate.create({
                data: {
                  fromMe: editedMessage.key.fromMe,
                  keyId: editedMessage.key.id,
                  remoteJid: editedMessage.key.remoteJid,
                  status: 'EDITED',
                  instanceId: this.instanceId,
                  messageId: (oldMessage as any).id,
                },
              });
            }
          }

          if ((type !== 'notify' && type !== 'append') || editedMessage || !received?.message) {
            continue;
          }

          if (Long.isLong(received.messageTimestamp)) {
            received.messageTimestamp = received.messageTimestamp?.toNumber();
          }

          if (settings?.groupsIgnore && received.key.remoteJid.includes('@g.us')) {
            continue;
          }

          const existingChat = await this.prismaRepository.chat.findFirst({
            where: { instanceId: this.instanceId, remoteJid: received.key.remoteJid },
            select: { id: true, name: true },
          });

          if (
            existingChat &&
            received.pushName &&
            existingChat.name !== received.pushName &&
            received.pushName.trim().length > 0 &&
            !received.key.fromMe &&
            !received.key.remoteJid.includes('@g.us')
          ) {
            this.sendDataWebhook(Events.CHATS_UPSERT, [{ ...existingChat, name: received.pushName }]);
            if (this.configService.get<Database>('DATABASE').SAVE_DATA.CHATS) {
              try {
                await this.prismaRepository.chat.update({
                  where: { id: existingChat.id },
                  data: { name: received.pushName },
                });
              } catch {
                console.log(`Chat insert record ignored: ${received.key.remoteJid} - ${this.instanceId}`);
              }
            }
          }

          const messageRaw = this.prepareMessage(received);

          if (isJidGroup(received.key.remoteJid)) {
            await this.saveGroupSenderPushName(received);
            messageRaw.pushName = await this.resolveGroupMessageSenderName(received, messageRaw.pushName);
          }

          if (messageRaw.key.remoteJid?.includes('@lid') && messageRaw.key.remoteJidAlt) {
            messageRaw.key.remoteJid = messageRaw.key.remoteJidAlt;
          }

          // Baileys can replay any message, including media and messages already saved by a send endpoint.
          if (received.key.id) {
            const alreadyStored = await this.prismaRepository.message.findFirst({
              where: {
                instanceId: this.instanceId,
                AND: [
                  { key: { path: ['id'], equals: received.key.id } },
                  {
                    OR: [
                      { key: { path: ['remoteJid'], equals: messageRaw.key.remoteJid } },
                      { key: { path: ['remoteJidAlt'], equals: messageRaw.key.remoteJid } },
                      ...(messageRaw.key.remoteJidAlt
                        ? [{ key: { path: ['remoteJid'], equals: messageRaw.key.remoteJidAlt } }]
                        : []),
                    ],
                  },
                ],
              },
              select: { id: true },
            });
            if (alreadyStored) continue;
          }

          if (messageRaw.messageType === 'pollUpdateMessage') {
            const pollCreationKey = messageRaw.message.pollUpdateMessage.pollCreationMessageKey;
            const pollMessage = (await this.getMessage(pollCreationKey, true)) as proto.IWebMessageInfo;
            const pollMessageSecret = (await this.getMessage(pollCreationKey)) as any;

            if (pollMessage) {
              const pollOptions =
                (pollMessage.message as any).pollCreationMessage?.options ||
                (pollMessage.message as any).pollCreationMessageV3?.options ||
                [];
              const pollVote = messageRaw.message.pollUpdateMessage.vote;

              const voterJid = received.key.fromMe
                ? this.instance.wuid
                : received.key.participant || received.key.remoteJid;

              let pollEncKey = pollMessageSecret?.messageContextInfo?.messageSecret;

              let successfulVoterJid = voterJid;

              if (typeof pollEncKey === 'string') {
                pollEncKey = Buffer.from(pollEncKey, 'base64');
              } else if (pollEncKey?.type === 'Buffer' && Array.isArray(pollEncKey.data)) {
                pollEncKey = Buffer.from(pollEncKey.data);
              }

              if (Buffer.isBuffer(pollEncKey) && pollEncKey.length === 44) {
                pollEncKey = Buffer.from(pollEncKey.toString('utf8'), 'base64');
              }

              if (pollVote.encPayload && pollEncKey) {
                const creatorCandidates = [
                  this.instance.wuid,
                  this.client.user?.lid,
                  pollMessage.key.participant,
                  (pollMessage.key as any).participantAlt,
                  pollMessage.key.remoteJid,
                ];

                const key = received.key as any;
                const voterCandidates = [
                  this.instance.wuid,
                  this.client.user?.lid,
                  key.participant,
                  key.participantAlt,
                  key.remoteJidAlt,
                  key.remoteJid,
                ];

                const uniqueCreators = [
                  ...new Set(creatorCandidates.filter(Boolean).map((id) => jidNormalizedUser(id))),
                ];
                const uniqueVoters = [...new Set(voterCandidates.filter(Boolean).map((id) => jidNormalizedUser(id)))];

                let decryptedVote;

                for (const creator of uniqueCreators) {
                  for (const voter of uniqueVoters) {
                    try {
                      decryptedVote = decryptPollVote(pollVote, {
                        pollCreatorJid: creator,
                        pollMsgId: pollMessage.key.id,
                        pollEncKey,
                        voterJid: voter,
                      } as any);
                      if (decryptedVote) {
                        successfulVoterJid = voter;
                        break;
                      }
                    } catch {
                      // Continue trying
                    }
                  }
                  if (decryptedVote) break;
                }

                if (decryptedVote) {
                  Object.assign(pollVote, decryptedVote);
                }
              }

              const selectedOptions = pollVote?.selectedOptions || [];

              const selectedOptionNames = pollOptions
                .filter((option) => {
                  const hash = createHash('sha256').update(option.optionName).digest();
                  return selectedOptions.some((selected) => Buffer.compare(selected, hash) === 0);
                })
                .map((option) => option.optionName);

              messageRaw.message.pollUpdateMessage.vote.selectedOptions = selectedOptionNames;

              const pollUpdates = pollOptions.map((option) => ({
                name: option.optionName,
                voters: selectedOptionNames.includes(option.optionName) ? [successfulVoterJid] : [],
              }));

              messageRaw.pollUpdates = pollUpdates;
            }
          }

          const normalizedReceivedContent = normalizeMessageContent(received?.message);
          const isMedia =
            normalizedReceivedContent?.imageMessage ||
            normalizedReceivedContent?.videoMessage ||
            normalizedReceivedContent?.stickerMessage ||
            normalizedReceivedContent?.documentMessage ||
            normalizedReceivedContent?.documentWithCaptionMessage ||
            normalizedReceivedContent?.ptvMessage ||
            normalizedReceivedContent?.audioMessage;

          const isVideo = normalizedReceivedContent?.videoMessage;

          if (this.localSettings.readMessages && received.key.id !== 'status@broadcast') {
            await this.client.readMessages([received.key]);
          }

          if (this.localSettings.readStatus && received.key.remoteJid === 'status@broadcast') {
            await this.client.readMessages([received.key]);
          }

          if (
            this.configService.get<Chatwoot>('CHATWOOT').ENABLED &&
            this.localChatwoot?.enabled &&
            !received.key.id.includes('@broadcast')
          ) {
            const chatwootSentMessage = await this.chatwootService.eventWhatsapp(
              Events.MESSAGES_UPSERT,
              { instanceName: this.instance.name, instanceId: this.instanceId },
              messageRaw,
            );

            if (chatwootSentMessage?.id) {
              messageRaw.chatwootMessageId = chatwootSentMessage.id;
              messageRaw.chatwootInboxId = chatwootSentMessage.inbox_id;
              messageRaw.chatwootConversationId = chatwootSentMessage.conversation_id;
            }
          }

          if (this.configService.get<Openai>('OPENAI').ENABLED && received?.message?.audioMessage) {
            const openAiDefaultSettings = await this.prismaRepository.openaiSetting.findFirst({
              where: { instanceId: this.instanceId },
              include: { OpenaiCreds: true },
            });

            if (openAiDefaultSettings && openAiDefaultSettings.openaiCredsId && openAiDefaultSettings.speechToText) {
              messageRaw.message.speechToText = `[audio] ${await this.openaiService.speechToText(received, this)}`;
            }
          }

          const isStatusBroadcast = messageRaw.key.remoteJid === 'status@broadcast';
          if (this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE || isStatusBroadcast) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { pollUpdates, ...messageData } = messageRaw;
            const msg = await this.prismaRepository.message.create({ data: messageData });

            const { remoteJid } = received.key;
            const timestamp = msg.messageTimestamp;
            const fromMe = received.key.fromMe.toString();
            const messageKey = `${remoteJid}_${timestamp}_${fromMe}`;

            const cachedTimestamp = await this.baileysCache.get(messageKey);

            if (!cachedTimestamp && !isStatusBroadcast) {
              if (!received.key.fromMe) {
                if (msg.status === status[3]) {
                  this.logger.log(`Update not read messages ${remoteJid}`);
                  await this.updateChatUnreadMessages(remoteJid);
                } else if (msg.status === status[4]) {
                  this.logger.log(`Update readed messages ${remoteJid} - ${timestamp}`);
                  await this.updateMessagesReadedByTimestamp(remoteJid, timestamp);
                }
              } else {
                // is send message by me
                this.logger.log(`Update readed messages ${remoteJid} - ${timestamp}`);
                await this.updateMessagesReadedByTimestamp(remoteJid, timestamp);
              }

              await this.baileysCache.set(messageKey, true, this.MESSAGE_CACHE_TTL_SECONDS);
            } else {
              this.logger.info(`Update readed messages duplicated ignored [avoid deadlock]: ${messageKey}`);
            }

            if (isMedia && this.shouldSaveMedia(messageRaw.key.remoteJid)) {
              try {
                if (isVideo && !this.configService.get<S3>('S3').SAVE_VIDEO) {
                  this.logger.warn('Video upload is disabled. Skipping video upload.');
                  // Skip video upload by returning early from this block
                  return;
                }

                const message: any = { ...received, message: normalizedReceivedContent };

                // Verificação adicional para garantir que há conteúdo de mídia real
                const hasRealMedia = this.hasValidMediaContent(message);

                if (!hasRealMedia) {
                  this.logger.warn('Message detected as media but contains no valid media content');
                } else {
                  const media = await this.getBase64FromMediaMessage({ message }, true);

                  if (!media) {
                    this.logger.verbose('No valid media to upload (messageContextInfo only), skipping MinIO');
                    return;
                  }

                  const { buffer, mediaType, fileName } = media;
                  const sizeBytes = Buffer.byteLength(buffer);
                  if (!(await hasCompanyStorageCapacity(this.prismaRepository, this.instanceId, sizeBytes))) {
                    this.logger.warn(`Company storage quota reached; skipping media ${msg.id}`);
                  } else {
                    const mimetype = mimeTypes.lookup(fileName).toString();
                    const storageTarget = await getCompanyStorageTarget(this.prismaRepository, this.instanceId);
                    const fullName = join(
                      `${this.instance.id}`,
                      received.key.remoteJid,
                      mediaType,
                      `${Date.now()}_${fileName}`,
                    );
                    const uploadResult = await s3Service.uploadFile(
                      fullName,
                      buffer,
                      sizeBytes,
                      {
                        'Content-Type': mimetype,
                      },
                      storageTarget,
                    );
                    if (uploadResult instanceof Error) throw uploadResult;

                    await this.prismaRepository.media.create({
                      data: {
                        messageId: msg.id,
                        instanceId: this.instanceId,
                        type: mediaType,
                        fileName: fullName,
                        mimetype,
                        sizeBytes,
                        storageBackend: storageTarget.backend,
                        storageBucket: storageTarget.bucket,
                      },
                    });

                    const mediaUrl = await s3Service.getObjectUrl(fullName, undefined, storageTarget);

                    messageRaw.message.mediaUrl = mediaUrl;

                    await this.prismaRepository.message.update({ where: { id: msg.id }, data: messageRaw });
                  }
                }
              } catch (error) {
                this.logger.error(['Error on upload file to minio', error?.message, error?.stack]);
              }
            }
          }

          if (this.localWebhook.enabled) {
            if (isMedia && this.localWebhook.webhookBase64) {
              try {
                const buffer = await downloadMediaMessage(
                  { key: received.key, message: received?.message },
                  'buffer',
                  {},
                  { logger: P({ level: 'error' }) as any, reuploadRequest: this.client.updateMediaMessage },
                );

                if (buffer) {
                  messageRaw.message.base64 = buffer.toString('base64');
                } else {
                  // retry to download media
                  const buffer = await downloadMediaMessage(
                    { key: received.key, message: received?.message },
                    'buffer',
                    {},
                    { logger: P({ level: 'error' }) as any, reuploadRequest: this.client.updateMediaMessage },
                  );

                  if (buffer) {
                    messageRaw.message.base64 = buffer.toString('base64');
                  }
                }
              } catch (error) {
                this.logger.error(['Error converting media to base64', error?.message]);
              }
            }
          }

          this.logger.verbose(messageRaw);

          sendTelemetry(`received.message.${messageRaw.messageType ?? 'unknown'}`);
          console.log(messageRaw);

          this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

          await chatbotController.emit({
            instance: { instanceName: this.instance.name, instanceId: this.instanceId },
            remoteJid: messageRaw.key.remoteJid,
            msg: messageRaw,
            pushName: messageRaw.pushName,
          });

          // A group message's pushName belongs to its sender, never to the group.
          if (isJidGroup(received.key.remoteJid)) {
            if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS) {
              const remoteJid = received.key.remoteJid;
              const profilePicUrl = (await this.profilePicture(remoteJid)).profilePictureUrl;
              await this.prismaRepository.contact.upsert({
                where: { remoteJid_instanceId: { remoteJid, instanceId: this.instanceId } },
                create: { remoteJid, instanceId: this.instanceId, profilePicUrl },
                update: { profilePicUrl },
              });
            }
            continue;
          }

          const contact = await this.prismaRepository.contact.findFirst({
            where: { remoteJid: received.key.remoteJid, instanceId: this.instanceId },
          });

          const contactRaw: {
            remoteJid: string;
            pushName: string;
            profilePicUrl?: string;
            instanceId: string;
          } = {
            remoteJid: received.key.remoteJid,
            pushName: received.key.fromMe ? '' : received.key.fromMe == null ? '' : received.pushName,
            profilePicUrl: (await this.profilePicture(received.key.remoteJid)).profilePictureUrl,
            instanceId: this.instanceId,
          };

          if (contactRaw.remoteJid === 'status@broadcast') {
            continue;
          }

          if (contactRaw.remoteJid.includes('@s.whatsapp') || contactRaw.remoteJid.includes('@lid')) {
            await saveOnWhatsappCache([
              {
                remoteJid:
                  messageRaw.key.addressingMode === 'lid' ? messageRaw.key.remoteJidAlt : messageRaw.key.remoteJid,
                remoteJidAlt: messageRaw.key.remoteJidAlt,
                lid: messageRaw.key.addressingMode === 'lid' ? 'lid' : null,
              },
            ]);
          }

          if (contact) {
            this.sendDataWebhook(Events.CONTACTS_UPDATE, contactRaw);

            if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
              await this.chatwootService.eventWhatsapp(
                Events.CONTACTS_UPDATE,
                { instanceName: this.instance.name, instanceId: this.instanceId },
                contactRaw,
              );
            }

            if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS)
              await this.prismaRepository.contact.upsert({
                where: { remoteJid_instanceId: { remoteJid: contactRaw.remoteJid, instanceId: contactRaw.instanceId } },
                create: contactRaw,
                update: contactRaw,
              });

            continue;
          }

          this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw);

          if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS)
            await this.prismaRepository.contact.upsert({
              where: { remoteJid_instanceId: { remoteJid: contactRaw.remoteJid, instanceId: contactRaw.instanceId } },
              update: contactRaw,
              create: contactRaw,
            });
        }
      } catch (error) {
        this.logger.error(error);
      }
    },

    'messages.update': async (args: { update: Partial<WAMessage>; key: WAMessageKey }[], settings: any) => {
      this.logger.verbose(`Update messages ${JSON.stringify(args, undefined, 2)}`);

      const readChatToUpdate: Record<string, true> = {}; // {remoteJid: true}

      for await (const { key, update } of args) {
        if (settings?.groupsIgnore && key.remoteJid?.includes('@g.us')) {
          continue;
        }

        const updateKey = `${this.instance.id}_${key.id}_${update.status}`;

        const cached = await this.baileysCache.get(updateKey);

        const secondsSinceEpoch = Math.floor(Date.now() / 1000);
        console.log('CACHE:', { cached, updateKey, messageTimestamp: update.messageTimestamp, secondsSinceEpoch });

        if (
          (update.messageTimestamp && update.messageTimestamp === cached) ||
          (!update.messageTimestamp && secondsSinceEpoch === cached)
        ) {
          this.logger.info(`Update Message duplicated ignored [avoid deadlock]: ${updateKey}`);
          continue;
        }

        if (update.messageTimestamp) {
          await this.baileysCache.set(updateKey, update.messageTimestamp, 30 * 60);
        } else {
          await this.baileysCache.set(updateKey, secondsSinceEpoch, 30 * 60);
        }

        if (status[update.status] === 'READ' && key.fromMe) {
          if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
            this.chatwootService.eventWhatsapp(
              'messages.read',
              { instanceName: this.instance.name, instanceId: this.instanceId },
              { key: key },
            );
          }
        }

        if (key.remoteJid !== 'status@broadcast' && key.id !== undefined) {
          let pollUpdates: any;

          if (update.pollUpdates) {
            const pollCreation = await this.getMessage(key);

            if (pollCreation) {
              pollUpdates = getAggregateVotesInPollMessage({
                message: pollCreation as proto.IMessage,
                pollUpdates: update.pollUpdates,
              });
            }
          }

          const message: any = {
            keyId: key.id,
            remoteJid: key?.remoteJid,
            fromMe: key.fromMe,
            participant: key?.participant,
            status: status[update.status] ?? 'SERVER_ACK',
            pollUpdates,
            instanceId: this.instanceId,
          };

          if (update.message) {
            message.message = update.message;
          }

          let findMessage: any;
          const configDatabaseData = this.configService.get<Database>('DATABASE').SAVE_DATA;
          if (configDatabaseData.HISTORIC || configDatabaseData.NEW_MESSAGE) {
            // Use raw SQL to avoid JSON path issues
            const protocolMapKey = `protocol_${key.id}`;
            const originalMessageId = (await this.baileysCache.get(protocolMapKey)) as string;

            if (originalMessageId) {
              message.keyId = originalMessageId;
            }

            const searchId = originalMessageId || key.id;

            const messages = (await this.prismaRepository.$queryRaw`
              SELECT * FROM "Message"
              WHERE "instanceId" = ${this.instanceId}
              AND "key"->>'id' = ${searchId}
              LIMIT 1
            `) as any[];
            findMessage = messages[0] || null;

            if (!findMessage?.id) {
              this.logger.warn(`Original message not found for update. Skipping. Key: ${JSON.stringify(key)}`);
              continue;
            }
            message.messageId = findMessage.id;
          }

          if (update.message === null && update.status === undefined) {
            this.sendDataWebhook(Events.MESSAGES_DELETE, { ...key, status: 'DELETED' });

            if (this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE)
              await this.prismaRepository.messageUpdate.create({ data: message });

            if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
              this.chatwootService.eventWhatsapp(
                Events.MESSAGES_DELETE,
                { instanceName: this.instance.name, instanceId: this.instanceId },
                { key: key },
              );
            }

            continue;
          }

          if (findMessage && update.status !== undefined && status[update.status] !== findMessage.status) {
            if (!key.fromMe && key.remoteJid) {
              readChatToUpdate[key.remoteJid] = true;

              const { remoteJid } = key;
              const timestamp = findMessage.messageTimestamp;
              const fromMe = key.fromMe.toString();
              const messageKey = `${remoteJid}_${timestamp}_${fromMe}`;

              const cachedTimestamp = await this.baileysCache.get(messageKey);

              if (!cachedTimestamp) {
                if (status[update.status] === status[4]) {
                  this.logger.log(`Update as read in message.update ${remoteJid} - ${timestamp}`);
                  await this.updateMessagesReadedByTimestamp(remoteJid, timestamp);
                  await this.baileysCache.set(messageKey, true, this.MESSAGE_CACHE_TTL_SECONDS);
                }

                await this.prismaRepository.message.update({
                  where: { id: findMessage.id },
                  data: { status: status[update.status] },
                });
              } else {
                this.logger.info(
                  `Update readed messages duplicated ignored in message.update [avoid deadlock]: ${messageKey}`,
                );
              }
            }
          }

          this.sendDataWebhook(Events.MESSAGES_UPDATE, message);

          if (this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { message: _msg, ...messageData } = message;
            await this.prismaRepository.messageUpdate.create({ data: messageData });
          }

          const existingChat = await this.prismaRepository.chat.findFirst({
            where: { instanceId: this.instanceId, remoteJid: message.remoteJid },
          });

          if (existingChat) {
            const chatToInsert = { remoteJid: message.remoteJid, instanceId: this.instanceId, unreadMessages: 0 };

            this.sendDataWebhook(Events.CHATS_UPSERT, [chatToInsert]);
            if (this.configService.get<Database>('DATABASE').SAVE_DATA.CHATS) {
              try {
                await this.prismaRepository.chat.update({ where: { id: existingChat.id }, data: chatToInsert });
              } catch {
                console.log(`Chat insert record ignored: ${chatToInsert.remoteJid} - ${chatToInsert.instanceId}`);
              }
            }
          }
        }
      }

      await Promise.all(Object.keys(readChatToUpdate).map((remoteJid) => this.updateChatUnreadMessages(remoteJid)));
    },
  };

  private readonly groupHandler = {
    'groups.upsert': (groupMetadata: GroupMetadata[]) => {
      this.sendDataWebhook(Events.GROUPS_UPSERT, groupMetadata);
      void this.saveGroupSubjects(groupMetadata).catch((error) => this.logger.error(error));
    },

    'groups.update': (groupMetadataUpdate: Partial<GroupMetadata>[]) => {
      this.sendDataWebhook(Events.GROUPS_UPDATE, groupMetadataUpdate);
      void this.saveGroupSubjects(groupMetadataUpdate).catch((error) => this.logger.error(error));

      groupMetadataUpdate.forEach((group) => {
        if (isJidGroup(group.id)) {
          this.updateGroupMetadataCache(group.id);
        }
      });
    },

    'group-participants.update': async (participantsUpdate: {
      id: string;
      participants: string[];
      action: ParticipantAction;
    }) => {
      // ENHANCEMENT: Adds participantsData field while maintaining backward compatibility
      // MAINTAINS: participants: string[] (original JID strings)
      // ADDS: participantsData: { jid: string, phoneNumber: string, name?: string, imgUrl?: string }[]
      // This enables LID to phoneNumber conversion without breaking existing webhook consumers

      // Helper to normalize participantId as phone number
      const normalizePhoneNumber = (id: string | null | undefined): string => {
        // Remove @lid, @s.whatsapp.net suffixes and extract just the number part
        return String(id || '').split('@')[0];
      };

      try {
        // Usa o mesmo método que o endpoint /group/participants
        const groupParticipants = await this.findParticipants({ groupJid: participantsUpdate.id });

        // Validação para garantir que temos dados válidos
        if (!groupParticipants?.participants || !Array.isArray(groupParticipants.participants)) {
          throw new Error('Invalid participant data received from findParticipants');
        }

        // Filtra apenas os participantes que estão no evento
        const resolvedParticipants = participantsUpdate.participants.map((participantId) => {
          const participantData = groupParticipants.participants.find((p) => p.id === participantId);

          let phoneNumber: string;
          if (participantData?.phoneNumber) {
            phoneNumber = participantData.phoneNumber;
          } else {
            phoneNumber = normalizePhoneNumber(participantId);
          }

          return {
            jid: participantId,
            phoneNumber,
            name: participantData?.name,
            imgUrl: participantData?.imgUrl,
          };
        });

        // Mantém formato original + adiciona dados resolvidos
        const enhancedParticipantsUpdate = {
          ...participantsUpdate,
          participants: participantsUpdate.participants, // Mantém array original de strings
          // Adiciona dados resolvidos em campo separado
          participantsData: resolvedParticipants,
        };

        this.sendDataWebhook(Events.GROUP_PARTICIPANTS_UPDATE, enhancedParticipantsUpdate);
      } catch (error) {
        this.logger.error(
          `Failed to resolve participant data for GROUP_PARTICIPANTS_UPDATE webhook: ${error.message} | Group: ${participantsUpdate.id} | Participants: ${participantsUpdate.participants.length}`,
        );
        // Fallback - envia sem conversão
        this.sendDataWebhook(Events.GROUP_PARTICIPANTS_UPDATE, participantsUpdate);
      }

      this.updateGroupMetadataCache(participantsUpdate.id);
    },
  };

  private readonly labelHandle = {
    [Events.LABELS_EDIT]: async (label: Label) => {
      this.sendDataWebhook(Events.LABELS_EDIT, { ...label, instance: this.instance.name });

      const labelsRepository = await this.prismaRepository.label.findMany({ where: { instanceId: this.instanceId } });

      const savedLabel = labelsRepository.find((l) => l.labelId === label.id);
      if (label.deleted && savedLabel) {
        await this.prismaRepository.label.delete({
          where: { labelId_instanceId: { instanceId: this.instanceId, labelId: label.id } },
        });
        this.sendDataWebhook(Events.LABELS_EDIT, { ...label, instance: this.instance.name });
        return;
      }

      const labelName = label.name.replace(/[^\x20-\x7E]/g, '');
      if (!savedLabel || savedLabel.color !== `${label.color}` || savedLabel.name !== labelName) {
        if (this.configService.get<Database>('DATABASE').SAVE_DATA.LABELS) {
          const labelData = {
            color: `${label.color}`,
            name: labelName,
            labelId: label.id,
            predefinedId: label.predefinedId,
            instanceId: this.instanceId,
          };
          await this.prismaRepository.label.upsert({
            where: { labelId_instanceId: { instanceId: labelData.instanceId, labelId: labelData.labelId } },
            update: labelData,
            create: labelData,
          });
        }
      }
    },

    [Events.LABELS_ASSOCIATION]: async (
      data: { association: LabelAssociation; type: 'remove' | 'add' },
      database: Database,
    ) => {
      this.logger.info(
        `labels association - ${data?.association?.chatId} (${data.type}-${data?.association?.type}): ${data?.association?.labelId}`,
      );
      if (database.SAVE_DATA.CHATS) {
        const instanceId = this.instanceId;
        const chatId = data.association.chatId;
        const labelId = data.association.labelId;

        if (data.type === 'add') {
          await this.addLabel(labelId, instanceId, chatId);
        } else if (data.type === 'remove') {
          await this.removeLabel(labelId, instanceId, chatId);
        }
      }

      this.sendDataWebhook(Events.LABELS_ASSOCIATION, {
        instance: this.instance.name,
        type: data.type,
        chatId: data.association.chatId,
        labelId: data.association.labelId,
      });
    },
  };

  private eventHandler() {
    this.client.ev.process(async (events) => {
      this.eventProcessingQueue = this.eventProcessingQueue.then(async () => {
        try {
          if (!this.endSession) {
            const database = this.configService.get<Database>('DATABASE');
            const settings = await this.findSettings();

            if (events.call) {
              const call = events.call[0];

              if (settings?.rejectCall && call.status == 'offer') {
                this.client.rejectCall(call.id, call.from);
              }

              if (settings?.msgCall?.trim().length > 0 && call.status == 'offer') {
                if (call.from.endsWith('@lid')) {
                  call.from = await this.client.signalRepository.lidMapping.getPNForLID(call.from as string);
                }
                const msg = await this.client.sendMessage(call.from, { text: settings.msgCall });

                this.client.ev.emit('messages.upsert', { messages: [msg], type: 'notify' });
              }

              this.sendDataWebhook(Events.CALL, call);
            }

            if (events['connection.update']) {
              this.connectionUpdate(events['connection.update']);
            }

            if (events['creds.update']) {
              this.instance.authState.saveCreds();
            }

            if (events['messaging-history.set']) {
              const payload = events['messaging-history.set'];
              await this.messageHandle['messaging-history.set'](payload);
            }

            if (events['messages.upsert']) {
              const payload = events['messages.upsert'];

              // this.messageProcessor.processMessage(payload, settings);
              await this.messageHandle['messages.upsert'](payload, settings);
            }

            if (events['messages.update']) {
              const payload = events['messages.update'];
              await this.messageHandle['messages.update'](payload, settings);
            }

            if (events['message-receipt.update']) {
              const payload = events['message-receipt.update'] as MessageUserReceiptUpdate[];
              const remotesJidMap: Record<string, number> = {};

              for (const event of payload) {
                if (typeof event.key.remoteJid === 'string' && typeof event.receipt.readTimestamp === 'number') {
                  remotesJidMap[event.key.remoteJid] = event.receipt.readTimestamp;
                }
              }

              await Promise.all(
                Object.keys(remotesJidMap).map(async (remoteJid) =>
                  this.updateMessagesReadedByTimestamp(remoteJid, remotesJidMap[remoteJid]),
                ),
              );
            }

            if (events['presence.update']) {
              const payload = events['presence.update'];

              if (settings?.groupsIgnore && payload.id.includes('@g.us')) {
                return;
              }

              let idAlt: string | null = null;
              if (isLidUser(payload.id)) {
                try {
                  idAlt = await this.client.signalRepository.lidMapping.getPNForLID(payload.id);
                } catch (error) {
                  this.logger.error(error);
                }
              }
              this.sendDataWebhook(Events.PRESENCE_UPDATE, { ...payload, idAlt });
            }

            if (!settings?.groupsIgnore) {
              if (events['groups.upsert']) {
                const payload = events['groups.upsert'];
                this.groupHandler['groups.upsert'](payload);
              }

              if (events['groups.update']) {
                const payload = events['groups.update'];
                this.groupHandler['groups.update'](payload);
              }

              if (events['group-participants.update']) {
                const payload = events['group-participants.update'] as any;
                this.groupHandler['group-participants.update'](payload);
              }
            }

            if (events['chats.upsert']) {
              const payload = events['chats.upsert'];
              this.chatHandle['chats.upsert'](payload);
            }

            if (events['chats.update']) {
              const payload = events['chats.update'];
              this.chatHandle['chats.update'](payload);
            }

            if (events['chats.delete']) {
              const payload = events['chats.delete'];
              this.chatHandle['chats.delete'](payload);
            }

            if (events['contacts.upsert']) {
              const payload = events['contacts.upsert'];
              await this.contactHandle['contacts.upsert'](payload);
            }

            if (events['contacts.update']) {
              const payload = events['contacts.update'];
              await this.contactHandle['contacts.update'](payload);
            }

            if (events[Events.LABELS_ASSOCIATION]) {
              const payload = events[Events.LABELS_ASSOCIATION];
              this.labelHandle[Events.LABELS_ASSOCIATION](payload, database);
              return;
            }

            if (events[Events.LABELS_EDIT]) {
              const payload = events[Events.LABELS_EDIT];
              this.labelHandle[Events.LABELS_EDIT](payload);
              return;
            }
          }
        } catch (error) {
          this.logger.error(error);
        }
      });
    });
  }

  private historySyncNotification(msg: proto.Message.IHistorySyncNotification) {
    const instance: InstanceDto = { instanceName: this.instance.name };

    if (
      this.configService.get<Chatwoot>('CHATWOOT').ENABLED &&
      this.localChatwoot?.enabled &&
      this.localChatwoot.importMessages &&
      this.isSyncNotificationFromUsedSyncType(msg)
    ) {
      if (msg.chunkOrder === 1) {
        this.chatwootService.startImportHistoryMessages(instance);
      }

      if (msg.progress === 100) {
        setTimeout(() => {
          this.chatwootService.importHistoryMessages(instance);
        }, 10000);
      }
    }

    return true;
  }

  private isSyncNotificationFromUsedSyncType(msg: proto.Message.IHistorySyncNotification) {
    return (
      (this.localSettings.syncFullHistory && msg?.syncType === 2) ||
      (!this.localSettings.syncFullHistory && msg?.syncType === 3)
    );
  }

  public async profilePicture(number: string) {
    const jid = createJid(number);

    try {
      const profilePictureUrl = await this.client.profilePictureUrl(jid, 'image');

      return { wuid: jid, profilePictureUrl };
    } catch {
      return { wuid: jid, profilePictureUrl: null };
    }
  }

  public async getStatus(number: string) {
    const jid = createJid(number);

    try {
      return { wuid: jid, status: (await this.client.fetchStatus(jid))[0]?.status };
    } catch {
      return { wuid: jid, status: null };
    }
  }

  public async fetchProfile(instanceName: string, number?: string) {
    const jid = number ? createJid(number) : this.client?.user?.id;

    const onWhatsapp = (await this.whatsappNumber({ numbers: [jid] }))?.shift();

    if (!onWhatsapp.exists) {
      throw new BadRequestException(onWhatsapp);
    }

    try {
      if (number) {
        const info = (await this.whatsappNumber({ numbers: [jid] }))?.shift();
        const picture = await this.profilePicture(info?.jid);
        const status = await this.getStatus(info?.jid);
        const business = await this.fetchBusinessProfile(info?.jid);

        return {
          wuid: info?.jid || jid,
          name: info?.name,
          numberExists: info?.exists,
          picture: picture?.profilePictureUrl,
          status: status?.status,
          isBusiness: business.isBusiness,
          email: business?.email,
          description: business?.description,
          website: business?.website?.shift(),
        };
      } else {
        const instanceNames = instanceName ? [instanceName] : null;
        const info: Instance = await waMonitor.instanceInfo(instanceNames);
        const business = await this.fetchBusinessProfile(jid);

        return {
          wuid: jid,
          name: info?.profileName,
          numberExists: true,
          picture: info?.profilePicUrl,
          status: info?.connectionStatus,
          isBusiness: business.isBusiness,
          email: business?.email,
          description: business?.description,
          website: business?.website?.shift(),
        };
      }
    } catch {
      return { wuid: jid, name: null, picture: null, status: null, os: null, isBusiness: false };
    }
  }

  public async offerCall({ number, isVideo, callDuration }: OfferCallDto) {
    const jid = createJid(number);

    try {
      // const call = await this.client.offerCall(jid, isVideo);
      // setTimeout(() => this.client.terminateCall(call.id, call.to), callDuration * 1000);

      // return call;
      return { id: '123', jid, isVideo, callDuration };
    } catch (error) {
      return error;
    }
  }

  private async sendMessage(
    sender: string,
    message: any,
    mentions: any,
    linkPreview: any,
    quoted: any,
    messageId?: string,
    ephemeralExpiration?: number,
    contextInfo?: any,
    // participants?: GroupParticipant[],
  ) {
    sender = sender.toLowerCase();

    const option: any = { quoted };

    if (isJidGroup(sender)) {
      option.useCachedGroupMetadata = true;
      // if (participants)
      //   option.cachedGroupMetadata = async () => {
      //     return { participants: participants as GroupParticipant[] };
      //   };
    }

    if (ephemeralExpiration) option.ephemeralExpiration = ephemeralExpiration;

    // NOTE: NÃO DEVEMOS GERAR O messageId AQUI, SOMENTE SE VIER INFORMADO POR PARAMETRO. A GERAÇÃO ANTERIOR IMPEDE O WZAP DE IDENTIFICAR A SOURCE.
    if (messageId) option.messageId = messageId;

    if (message['viewOnceMessage'] || message['interactiveMessage'] || message['listMessage']) {
      const interactiveMessage = message.interactiveMessage ?? message.viewOnceMessage?.message?.interactiveMessage;
      const hasCopyButton = interactiveMessage?.nativeFlowMessage?.buttons?.some(
        (button) => button.name === 'cta_copy',
      );
      const m = generateWAMessageFromContent(sender, message, {
        timestamp: new Date(),
        userJid: this.instance.wuid,
        messageId,
        quoted,
        ephemeralExpiration,
      });
      const id = await this.client.relayMessage(sender, m.message, {
        messageId: m.key.id,
        additionalNodes: message.listMessage
          ? this.listRelayNodes()
          : interactiveMessage
            ? this.interactiveRelayNodes(hasCopyButton && !isJidGroup(sender))
            : undefined,
      });
      m.key = { id, remoteJid: sender, participant: isPnUser(sender) ? sender : undefined, fromMe: true };
      for (const [key, value] of Object.entries(m)) {
        if (!value || (isArray(value) && value.length) === 0) {
          delete m[key];
        }
      }
      return m;
    }

    if (
      !message['audio'] &&
      !message['poll'] &&
      !message['sticker'] &&
      !message['conversation'] &&
      sender !== 'status@broadcast'
    ) {
      if (message['reactionMessage']) {
        return await this.client.sendMessage(
          sender,
          {
            react: { text: message['reactionMessage']['text'], key: message['reactionMessage']['key'] },
          } as unknown as AnyMessageContent,
          option as unknown as MiscMessageGenerationOptions,
        );
      }
    }

    if (contextInfo) {
      message['contextInfo'] = contextInfo;
    }

    if (message['conversation']) {
      return await this.client.sendMessage(
        sender,
        {
          text: message['conversation'],
          mentions,
          linkPreview: linkPreview,
          contextInfo: message['contextInfo'],
        } as unknown as AnyMessageContent,
        option as unknown as MiscMessageGenerationOptions,
      );
    }

    if (!message['audio'] && !message['poll'] && !message['sticker'] && sender != 'status@broadcast') {
      return await this.client.sendMessage(
        sender,
        {
          forward: { key: { remoteJid: this.instance.wuid, fromMe: true }, message },
          mentions,
          contextInfo: message['contextInfo'],
        },
        option as unknown as MiscMessageGenerationOptions,
      );
    }

    if (sender === 'status@broadcast') {
      let jidList;
      if (message['status'].option.allContacts) {
        const contacts = await this.prismaRepository.contact.findMany({
          where: { instanceId: this.instanceId, remoteJid: { not: { endsWith: '@g.us' } } },
        });

        jidList = contacts.map((contact) => contact.remoteJid);
      } else {
        jidList = message['status'].option.statusJidList;
      }

      const batchSize = 10;

      const batches = Array.from({ length: Math.ceil(jidList.length / batchSize) }, (_, i) =>
        jidList.slice(i * batchSize, i * batchSize + batchSize),
      );

      let msgId: string | null = null;

      let firstMessage: WAMessage;

      const firstBatch = batches.shift();

      if (firstBatch) {
        firstMessage = await this.client.sendMessage(
          sender,
          message['status'].content as unknown as AnyMessageContent,
          {
            backgroundColor: message['status'].option.backgroundColor,
            font: message['status'].option.font,
            statusJidList: firstBatch,
          } as unknown as MiscMessageGenerationOptions,
        );

        msgId = firstMessage.key.id;
      }

      if (batches.length === 0) return firstMessage;

      await Promise.allSettled(
        batches.map(async (batch) => {
          const messageSent = await this.client.sendMessage(
            sender,
            message['status'].content as unknown as AnyMessageContent,
            {
              backgroundColor: message['status'].option.backgroundColor,
              font: message['status'].option.font,
              statusJidList: batch,
              messageId: msgId,
            } as unknown as MiscMessageGenerationOptions,
          );

          return messageSent;
        }),
      );

      return firstMessage;
    }

    return await this.client.sendMessage(
      sender,
      message as unknown as AnyMessageContent,
      option as unknown as MiscMessageGenerationOptions,
    );
  }

  private interactiveRelayNodes(includeBotNode = false): BinaryNode[] {
    return [
      ...(includeBotNode ? [{ tag: 'bot', attrs: { biz_bot: '1' } } as BinaryNode] : []),
      {
        tag: 'biz',
        attrs: includeBotNode
          ? {
              actual_actors: '2',
              host_storage: '2',
              privacy_mode_ts: (Math.floor(Date.now() / 1000) - 77980457).toString(),
            }
          : {},
        content: [
          {
            tag: 'interactive',
            attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
          },
          ...(includeBotNode ? [{ tag: 'quality_control', attrs: { source_type: 'third_party' } } as BinaryNode] : []),
        ],
      },
    ];
  }

  private listRelayNodes(): BinaryNode[] {
    return [
      {
        tag: 'biz',
        attrs: {},
        content: [{ tag: 'list', attrs: { type: 'product_list', v: '2' } }],
      },
    ];
  }

  private async sendMessageWithTyping<T = proto.IMessage>(
    number: string,
    message: T,
    options?: Options,
    isIntegration = false,
  ) {
    const isWA = (await this.whatsappNumber({ numbers: [number] }))?.shift();

    if (!isWA.exists && !isJidGroup(isWA.jid) && !isWA.jid.includes('@broadcast')) {
      throw new BadRequestException(isWA);
    }

    const sender = isWA.jid.toLowerCase();

    this.logger.verbose(`Sending message to ${sender}`);

    try {
      if (options?.delay) {
        this.logger.verbose(`Typing for ${options.delay}ms to ${sender}`);
        if (options.delay > 20000) {
          let remainingDelay = options.delay;
          while (remainingDelay > 20000) {
            await this.client.presenceSubscribe(sender);

            await this.client.sendPresenceUpdate((options.presence as WAPresence) ?? 'composing', sender);

            await delay(20000);

            await this.client.sendPresenceUpdate('paused', sender);

            remainingDelay -= 20000;
          }
          if (remainingDelay > 0) {
            await this.client.presenceSubscribe(sender);

            await this.client.sendPresenceUpdate((options.presence as WAPresence) ?? 'composing', sender);

            await delay(remainingDelay);

            await this.client.sendPresenceUpdate('paused', sender);
          }
        } else {
          await this.client.presenceSubscribe(sender);

          await this.client.sendPresenceUpdate((options.presence as WAPresence) ?? 'composing', sender);

          await delay(options.delay);

          await this.client.sendPresenceUpdate('paused', sender);
        }
      }

      const linkPreview = options?.linkPreview != false ? undefined : false;

      let quoted: WAMessage;

      if (options?.quoted) {
        const m = options?.quoted;

        const msg = m?.message ? m : ((await this.getMessage(m.key, true)) as WAMessage);

        if (msg) {
          quoted = msg;
        }
      }

      let messageSent: WAMessage;

      let mentions: string[];
      let contextInfo: any;

      if (isJidGroup(sender)) {
        let group;
        try {
          const cache = this.configService.get<CacheConf>('CACHE');
          if (!cache.REDIS.ENABLED && !cache.LOCAL.ENABLED) group = await this.findGroup({ groupJid: sender }, 'inner');
          else group = await this.getGroupMetadataCache(sender);
          // group = await this.findGroup({ groupJid: sender }, 'inner');
        } catch {
          throw new NotFoundException('Group not found');
        }

        if (!group) {
          throw new NotFoundException('Group not found');
        }

        if (options?.mentionsEveryOne) {
          mentions = group.participants.map((participant) => participant.id);
        } else if (options?.mentioned?.length) {
          mentions = options.mentioned.map((mention) => {
            const jid = createJid(mention);
            if (isJidGroup(jid)) {
              return null;
            }
            return jid;
          });
        }

        messageSent = await this.sendMessage(
          sender,
          message,
          mentions,
          linkPreview,
          quoted,
          null,
          group?.ephemeralDuration,
          // group?.participants,
        );
      } else {
        contextInfo = {
          mentionedJid: [],
          groupMentions: [],
          //expiration: 7776000,
          ephemeralSettingTimestamp: {
            low: Math.floor(Date.now() / 1000) - 172800,
            high: 0,
            unsigned: false,
          },
          disappearingMode: { initiator: 0 },
        };
        messageSent = await this.sendMessage(
          sender,
          message,
          mentions,
          linkPreview,
          quoted,
          null,
          undefined,
          contextInfo,
        );
      }

      if (Long.isLong(messageSent?.messageTimestamp)) {
        messageSent.messageTimestamp = messageSent.messageTimestamp?.toNumber();
      }

      const messageRaw = this.prepareMessage(messageSent);

      const normalizedSentContent = normalizeMessageContent(messageSent?.message);
      const isMedia =
        normalizedSentContent?.imageMessage ||
        normalizedSentContent?.videoMessage ||
        normalizedSentContent?.stickerMessage ||
        normalizedSentContent?.ptvMessage ||
        normalizedSentContent?.documentMessage ||
        normalizedSentContent?.documentWithCaptionMessage ||
        normalizedSentContent?.audioMessage;

      const isVideo = normalizedSentContent?.videoMessage;

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && !isIntegration) {
        this.chatwootService.eventWhatsapp(
          Events.SEND_MESSAGE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );
      }

      if (this.configService.get<Openai>('OPENAI').ENABLED && messageRaw?.message?.audioMessage) {
        const openAiDefaultSettings = await this.prismaRepository.openaiSetting.findFirst({
          where: { instanceId: this.instanceId },
          include: { OpenaiCreds: true },
        });

        if (openAiDefaultSettings && openAiDefaultSettings.openaiCredsId && openAiDefaultSettings.speechToText) {
          messageRaw.message.speechToText = `[audio] ${await this.openaiService.speechToText(messageRaw, this)}`;
        }
      }

      if (this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
        const existingMessage = await this.prismaRepository.message.findFirst({
          where: {
            instanceId: this.instanceId,
            AND: [
              { key: { path: ['id'], equals: messageRaw.key.id } },
              { key: { path: ['remoteJid'], equals: messageRaw.key.remoteJid } },
            ],
          },
          select: { id: true },
        });
        const msg = existingMessage || (await this.prismaRepository.message.create({ data: messageRaw }));

        if (!existingMessage && isMedia && this.shouldSaveMedia(messageRaw.key.remoteJid)) {
          try {
            if (isVideo && !this.configService.get<S3>('S3').SAVE_VIDEO) {
              throw new Error('Video upload is disabled.');
            }

            const message: any = { ...messageRaw, message: normalizedSentContent };

            // Verificação adicional para garantir que há conteúdo de mídia real
            const hasRealMedia = this.hasValidMediaContent(message);

            if (!hasRealMedia) {
              this.logger.warn('Message detected as media but contains no valid media content');
            } else {
              const media = await this.getBase64FromMediaMessage({ message }, true);

              if (!media) {
                this.logger.verbose('No valid media to upload (messageContextInfo only), skipping MinIO');
                return;
              }

              const { buffer, mediaType, fileName } = media;
              const sizeBytes = Buffer.byteLength(buffer);
              if (!(await hasCompanyStorageCapacity(this.prismaRepository, this.instanceId, sizeBytes))) {
                this.logger.warn(`Company storage quota reached; skipping media ${msg.id}`);
              } else {
                const mimetype = mimeTypes.lookup(fileName).toString();
                const storageTarget = await getCompanyStorageTarget(this.prismaRepository, this.instanceId);

                const fullName = join(
                  `${this.instance.id}`,
                  messageRaw.key.remoteJid,
                  `${messageRaw.key.id}`,
                  mediaType,
                  fileName,
                );

                const uploadResult = await s3Service.uploadFile(
                  fullName,
                  buffer,
                  sizeBytes,
                  {
                    'Content-Type': mimetype,
                  },
                  storageTarget,
                );
                if (uploadResult instanceof Error) throw uploadResult;

                await this.prismaRepository.media.create({
                  data: {
                    messageId: msg.id,
                    instanceId: this.instanceId,
                    type: mediaType,
                    fileName: fullName,
                    mimetype,
                    sizeBytes,
                    storageBackend: storageTarget.backend,
                    storageBucket: storageTarget.bucket,
                  },
                });

                const mediaUrl = await s3Service.getObjectUrl(fullName, undefined, storageTarget);

                messageRaw.message.mediaUrl = mediaUrl;

                await this.prismaRepository.message.update({ where: { id: msg.id }, data: messageRaw });
              }
            }
          } catch (error) {
            this.logger.error(['Error on upload file to minio', error?.message, error?.stack]);
          }
        }
      }

      if (this.localWebhook.enabled) {
        if (isMedia && this.localWebhook.webhookBase64) {
          try {
            const buffer = await downloadMediaMessage(
              { key: messageRaw.key, message: messageRaw?.message },
              'buffer',
              {},
              { logger: P({ level: 'error' }) as any, reuploadRequest: this.client.updateMediaMessage },
            );

            if (buffer) {
              messageRaw.message.base64 = buffer.toString('base64');
            } else {
              // retry to download media
              const buffer = await downloadMediaMessage(
                { key: messageRaw.key, message: messageRaw?.message },
                'buffer',
                {},
                { logger: P({ level: 'error' }) as any, reuploadRequest: this.client.updateMediaMessage },
              );

              if (buffer) {
                messageRaw.message.base64 = buffer.toString('base64');
              }
            }
          } catch (error) {
            this.logger.error(['Error converting media to base64', error?.message]);
          }
        }
      }

      this.logger.verbose(messageSent);

      this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && isIntegration) {
        await chatbotController.emit({
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
          isIntegration,
        });
      }

      return messageRaw;
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  // Instance Controller
  public async subscribePresence({ number }: SubscribePresenceDto) {
    try {
      await this.client.presenceSubscribe(number);
      return { subscribed: true };
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  public async sendPresence(data: SendPresenceDto) {
    try {
      const { number } = data;

      const isWA = (await this.whatsappNumber({ numbers: [number] }))?.shift();

      if (!isWA.exists && !isJidGroup(isWA.jid) && !isWA.jid.includes('@broadcast')) {
        throw new BadRequestException(isWA);
      }

      const sender = isWA.jid;

      // A zero delay lets interactive clients manage the composing/paused lifecycle.
      if (data.delay === 0) {
        await this.client.presenceSubscribe(sender);
        await this.client.sendPresenceUpdate(data.presence, sender);
        return { presence: data.presence };
      }

      if (data?.delay && data?.delay > 20000) {
        let remainingDelay = data?.delay;
        while (remainingDelay > 20000) {
          await this.client.presenceSubscribe(sender);

          await this.client.sendPresenceUpdate((data?.presence as WAPresence) ?? 'composing', sender);

          await delay(20000);

          await this.client.sendPresenceUpdate('paused', sender);

          remainingDelay -= 20000;
        }
        if (remainingDelay > 0) {
          await this.client.presenceSubscribe(sender);

          await this.client.sendPresenceUpdate((data?.presence as WAPresence) ?? 'composing', sender);

          await delay(remainingDelay);

          await this.client.sendPresenceUpdate('paused', sender);
        }
      } else {
        await this.client.presenceSubscribe(sender);

        await this.client.sendPresenceUpdate((data?.presence as WAPresence) ?? 'composing', sender);

        await delay(data?.delay);

        await this.client.sendPresenceUpdate('paused', sender);
      }

      return { presence: data.presence };
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  // Presence Controller
  public async setPresence(data: SetPresenceDto) {
    try {
      await this.client.sendPresenceUpdate(data.presence);

      return { presence: data.presence };
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  // Send Message Controller
  public async textMessage(data: SendTextDto, isIntegration = false) {
    const text = data.text;

    if (!text || text.trim().length === 0) {
      throw new BadRequestException('Text is required');
    }

    return await this.sendMessageWithTyping(
      data.number,
      { conversation: data.text },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
    );
  }

  public async pollMessage(data: SendPollDto) {
    return await this.sendMessageWithTyping(
      data.number,
      { poll: { name: data.name, selectableCount: data.selectableCount, values: data.values } },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
    );
  }

  private async formatStatusMessage(status: StatusMessage) {
    if (!status.type) {
      throw new BadRequestException('Type is required');
    }

    if (!status.content) {
      throw new BadRequestException('Content is required');
    }

    if (status.allContacts) {
      const contacts = await this.prismaRepository.contact.findMany({ where: { instanceId: this.instanceId } });

      if (!contacts.length) {
        throw new BadRequestException('Contacts not found');
      }

      status.statusJidList = contacts.map((contact) => contact.remoteJid);
    }

    if (!status.statusJidList?.length && !status.allContacts) {
      throw new BadRequestException('StatusJidList is required');
    }

    if (status.type === 'text') {
      if (!status.backgroundColor) {
        throw new BadRequestException('Background color is required');
      }

      if (!status.font) {
        throw new BadRequestException('Font is required');
      }

      return {
        content: { text: status.content },
        option: { backgroundColor: status.backgroundColor, font: status.font, statusJidList: status.statusJidList },
      };
    }
    if (status.type === 'image') {
      return {
        content: { image: { url: status.content }, caption: status.caption },
        option: { statusJidList: status.statusJidList },
      };
    }

    if (status.type === 'video') {
      return {
        content: { video: { url: status.content }, caption: status.caption },
        option: { statusJidList: status.statusJidList },
      };
    }

    if (status.type === 'audio') {
      const convert = await this.processAudioMp4(status.content);
      if (Buffer.isBuffer(convert)) {
        const result = {
          content: { audio: convert, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
          option: { statusJidList: status.statusJidList },
        };

        return result;
      } else {
        throw new InternalServerErrorException(convert);
      }
    }

    throw new BadRequestException('Type not found');
  }

  public async statusMessage(data: SendStatusDto, file?: any) {
    const mediaData: SendStatusDto = { ...data };

    if (file) {
      const mimeType = file.mimetype || 'application/octet-stream';
      mediaData.content = `data:${mimeType};base64,${file.buffer.toString('base64')}`;
    }

    const status = await this.formatStatusMessage(mediaData);

    const statusSent = await this.sendMessageWithTyping('status@broadcast', { status });

    return statusSent;
  }

  private async prepareMediaMessage(mediaMessage: MediaMessage) {
    try {
      const type = mediaMessage.mediatype === 'ptv' ? 'video' : mediaMessage.mediatype;

      let mediaInput: any;
      if (mediaMessage.mediatype === 'image') {
        let imageBuffer: Buffer;
        if (isURL(mediaMessage.media)) {
          let config: any = { responseType: 'arraybuffer' };

          if (this.localProxy?.enabled) {
            config = {
              ...config,
              httpsAgent: makeProxyAgent({
                host: this.localProxy.host,
                port: this.localProxy.port,
                protocol: this.localProxy.protocol,
                username: this.localProxy.username,
                password: this.localProxy.password,
              }),
            };
          }

          const response = await axios.get(mediaMessage.media, config);
          imageBuffer = Buffer.from(response.data, 'binary');
        } else {
          imageBuffer = Buffer.from(mediaMessage.media, 'base64');
        }

        mediaInput = await sharp(imageBuffer).jpeg().toBuffer();
        mediaMessage.fileName ??= 'image.jpg';
        mediaMessage.mimetype = 'image/jpeg';
      } else {
        mediaInput = isURL(mediaMessage.media)
          ? { url: mediaMessage.media }
          : Buffer.from(mediaMessage.media, 'base64');
      }

      const prepareMedia = await prepareWAMessageMedia(
        {
          [type]: mediaInput,
        } as any,
        { upload: this.client.waUploadToServer },
      );

      const mediaType = mediaMessage.mediatype + 'Message';

      if (mediaMessage.mediatype === 'document' && !mediaMessage.fileName) {
        const regex = new RegExp(/.*\/(.+?)\./);
        const arrayMatch = regex.exec(mediaMessage.media);
        mediaMessage.fileName = arrayMatch[1];
      }

      if (mediaMessage.mediatype === 'image' && !mediaMessage.fileName) {
        mediaMessage.fileName = 'image.jpg';
      }

      if (mediaMessage.mediatype === 'video' && !mediaMessage.fileName) {
        mediaMessage.fileName = 'video.mp4';
      }

      let mimetype: string | false;

      if (mediaMessage.mimetype) {
        mimetype = mediaMessage.mimetype;
      } else {
        mimetype = mimeTypes.lookup(mediaMessage.fileName);

        if (!mimetype && isURL(mediaMessage.media)) {
          let config: any = { responseType: 'arraybuffer' };

          if (this.localProxy?.enabled) {
            config = {
              ...config,
              httpsAgent: makeProxyAgent({
                host: this.localProxy.host,
                port: this.localProxy.port,
                protocol: this.localProxy.protocol,
                username: this.localProxy.username,
                password: this.localProxy.password,
              }),
            };
          }

          const response = await axios.get(mediaMessage.media, config);

          mimetype = response.headers['content-type'];
        }
      }

      if (mediaMessage.mediatype === 'ptv') {
        prepareMedia[mediaType] = prepareMedia[type + 'Message'];
        mimetype = 'video/mp4';

        if (!prepareMedia[mediaType]) {
          throw new Error('Failed to prepare video message');
        }

        try {
          let mediaInput;
          if (isURL(mediaMessage.media)) {
            mediaInput = mediaMessage.media;
          } else {
            const mediaBuffer = Buffer.from(mediaMessage.media, 'base64');
            if (!mediaBuffer || mediaBuffer.length === 0) {
              throw new Error('Invalid media buffer');
            }
            mediaInput = mediaBuffer;
          }

          const duration = await getVideoDuration(mediaInput);
          if (!duration || duration <= 0) {
            throw new Error('Invalid media duration');
          }

          this.logger.verbose(`Video duration: ${duration} seconds`);
          prepareMedia[mediaType].seconds = duration;
        } catch (error) {
          this.logger.error('Error getting video duration:');
          this.logger.error(error);
          throw new Error(`Failed to get video duration: ${error.message}`);
        }
      }

      if (mediaMessage?.fileName) {
        mimetype = mimeTypes.lookup(mediaMessage.fileName).toString();
        if (mimetype === 'application/mp4') {
          mimetype = 'video/mp4';
        }
      }

      prepareMedia[mediaType].caption = mediaMessage?.caption;
      prepareMedia[mediaType].mimetype = mimetype;
      prepareMedia[mediaType].fileName = mediaMessage.fileName;

      if (mediaMessage.mediatype === 'video') {
        prepareMedia[mediaType].gifPlayback = false;
      }

      return generateWAMessageFromContent(
        '',
        { [mediaType]: { ...prepareMedia[mediaType] } },
        { userJid: this.instance.wuid },
      );
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString() || error);
    }
  }

  private async convertToWebP(image: string): Promise<Buffer> {
    try {
      let imageBuffer: Buffer;

      if (isBase64(image)) {
        const base64Data = image.replace(/^data:image\/(jpeg|png|gif);base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        const timestamp = new Date().getTime();
        const parsedURL = new URL(image);
        parsedURL.searchParams.set('timestamp', timestamp.toString());
        const url = parsedURL.toString();

        let config: any = { responseType: 'arraybuffer' };

        if (this.localProxy?.enabled) {
          config = {
            ...config,
            httpsAgent: makeProxyAgent({
              host: this.localProxy.host,
              port: this.localProxy.port,
              protocol: this.localProxy.protocol,
              username: this.localProxy.username,
              password: this.localProxy.password,
            }),
          };
        }

        const response = await axios.get(url, config);
        imageBuffer = Buffer.from(response.data, 'binary');
      }

      const isAnimated = this.isAnimated(image, imageBuffer);

      if (isAnimated) {
        return await sharp(imageBuffer, { animated: true }).webp({ quality: 80 }).toBuffer();
      } else {
        return await sharp(imageBuffer).webp().toBuffer();
      }
    } catch (error) {
      console.error('Erro ao converter a imagem para WebP:', error);
      throw error;
    }
  }

  private isAnimatedWebp(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;

    return buffer.indexOf(Buffer.from('ANIM')) !== -1;
  }

  private isAnimated(image: string, buffer: Buffer): boolean {
    const lowerCaseImage = image.toLowerCase();

    if (lowerCaseImage.includes('.gif')) return true;

    if (lowerCaseImage.includes('.webp')) return this.isAnimatedWebp(buffer);

    return false;
  }

  public async mediaSticker(data: SendStickerDto, file?: any) {
    const mediaData: SendStickerDto = { ...data };

    if (file) mediaData.sticker = file.buffer.toString('base64');

    const convert = data?.notConvertSticker
      ? Buffer.from(data.sticker, 'base64')
      : await this.convertToWebP(data.sticker);
    const gifPlayback = data.sticker.includes('.gif');
    const result = await this.sendMessageWithTyping(
      data.number,
      { sticker: convert, gifPlayback },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
    );

    return result;
  }

  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false) {
    const mediaData: SendMediaDto = { ...data };

    if (file) mediaData.media = file.buffer.toString('base64');

    const generate = await this.prepareMediaMessage(mediaData);

    const mediaSent = await this.sendMessageWithTyping(
      data.number,
      { ...generate.message },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
    );

    return mediaSent;
  }

  public async ptvMessage(data: SendPtvDto, file?: any, isIntegration = false) {
    const mediaData: SendMediaDto = {
      number: data.number,
      media: data.video,
      mediatype: 'ptv',
      delay: data?.delay,
      quoted: data?.quoted,
      mentionsEveryOne: data?.mentionsEveryOne,
      mentioned: data?.mentioned,
    };

    if (file) mediaData.media = file.buffer.toString('base64');

    const generate = await this.prepareMediaMessage(mediaData);

    const mediaSent = await this.sendMessageWithTyping(
      data.number,
      { ...generate.message },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
    );

    return mediaSent;
  }

  public async processAudioMp4(audio: string) {
    let inputStream: PassThrough;

    if (isURL(audio)) {
      const response = await axios.get(audio, { responseType: 'stream' });
      inputStream = response.data;
    } else {
      const audioBuffer = Buffer.from(audio, 'base64');
      inputStream = new PassThrough();
      inputStream.end(audioBuffer);
    }

    return new Promise<Buffer>((resolve, reject) => {
      const ffmpegProcess = spawn(ffmpegPath.path, [
        '-i',
        'pipe:0',
        '-vn',
        '-ab',
        '128k',
        '-ar',
        '44100',
        '-f',
        'mp4',
        '-movflags',
        'frag_keyframe+empty_moov',
        'pipe:1',
      ]);

      const outputChunks: Buffer[] = [];
      let stderrData = '';

      ffmpegProcess.stdout.on('data', (chunk) => {
        outputChunks.push(chunk);
      });

      ffmpegProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
        this.logger.verbose(`ffmpeg stderr: ${data}`);
      });

      ffmpegProcess.on('error', (error) => {
        console.error('Error in ffmpeg process', error);
        reject(error);
      });

      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          this.logger.verbose('Audio converted to mp4');
          const outputBuffer = Buffer.concat(outputChunks);
          resolve(outputBuffer);
        } else {
          this.logger.error(`ffmpeg exited with code ${code}`);
          this.logger.error(`ffmpeg stderr: ${stderrData}`);
          reject(new Error(`ffmpeg exited with code ${code}: ${stderrData}`));
        }
      });

      inputStream.pipe(ffmpegProcess.stdin);

      inputStream.on('error', (err) => {
        console.error('Error in inputStream', err);
        ffmpegProcess.stdin.end();
        reject(err);
      });
    });
  }

  public async processAudio(audio: string): Promise<Buffer> {
    const audioConverterConfig = this.configService.get<AudioConverter>('AUDIO_CONVERTER');
    if (audioConverterConfig.API_URL) {
      this.logger.verbose('Using audio converter API');
      const formData = new FormData();

      if (isURL(audio)) {
        formData.append('url', audio);
      } else {
        formData.append('base64', audio);
      }

      const { data } = await axios.post(audioConverterConfig.API_URL, formData, {
        headers: { ...formData.getHeaders(), apikey: audioConverterConfig.API_KEY },
      });

      if (!data.audio) {
        throw new InternalServerErrorException('Failed to convert audio');
      }

      this.logger.verbose('Audio converted');
      return Buffer.from(data.audio, 'base64');
    } else {
      let inputAudioStream: PassThrough;

      if (isURL(audio)) {
        const timestamp = new Date().getTime();
        const parsedURL = new URL(audio);
        parsedURL.searchParams.set('timestamp', timestamp.toString());
        const url = parsedURL.toString();

        const config: any = { responseType: 'stream' };

        const response = await axios.get(url, config);
        inputAudioStream = response.data.pipe(new PassThrough());
      } else {
        const audioBuffer = Buffer.from(audio, 'base64');
        inputAudioStream = new PassThrough();
        inputAudioStream.end(audioBuffer);
      }

      const isLpcm = isURL(audio) && /\.lpcm($|\?)/i.test(audio);

      return new Promise((resolve, reject) => {
        const outputAudioStream = new PassThrough();
        const chunks: Buffer[] = [];

        outputAudioStream.on('data', (chunk) => chunks.push(chunk));
        outputAudioStream.on('end', () => {
          const outputBuffer = Buffer.concat(chunks);
          resolve(outputBuffer);
        });

        outputAudioStream.on('error', (error) => {
          console.log('error', error);
          reject(error);
        });

        ffmpeg.setFfmpegPath(ffmpegPath.path);

        let command = ffmpeg(inputAudioStream);

        if (isLpcm) {
          this.logger.verbose('Detected LPCM input – applying raw PCM settings');
          command = command.inputFormat('s16le').inputOptions(['-ar', '24000', '-ac', '1']);
        }

        command
          .outputFormat('ogg')
          .noVideo()
          .audioCodec('libopus')
          .addOutputOptions('-avoid_negative_ts make_zero')
          .audioBitrate('128k')
          .audioFrequency(48000)
          .audioChannels(1)
          .outputOptions([
            '-write_xing',
            '0',
            '-compression_level',
            '10',
            '-application',
            'voip',
            '-fflags',
            '+bitexact',
            '-flags',
            '+bitexact',
            '-id3v2_version',
            '0',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-write_bext',
            '0',
          ])
          .pipe(outputAudioStream, { end: true })
          .on('error', function (error) {
            console.log('error', error);
            reject(error);
          });
      });
    }
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false) {
    const mediaData: SendAudioDto = { ...data };

    if (file?.buffer) {
      mediaData.audio = file.buffer.toString('base64');
    } else if (!isURL(data.audio) && !isBase64(data.audio)) {
      console.error('Invalid file or audio source');
      throw new BadRequestException('File buffer, URL, or base64 audio is required');
    }

    if (!data?.encoding && data?.encoding !== false) {
      data.encoding = true;
    }

    if (data?.encoding) {
      const convert = await this.processAudio(mediaData.audio);

      if (Buffer.isBuffer(convert)) {
        const result = this.sendMessageWithTyping<AnyMessageContent>(
          data.number,
          { audio: convert, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
          { presence: 'recording', delay: data?.delay },
          isIntegration,
        );

        return result;
      } else {
        throw new InternalServerErrorException('Failed to convert audio');
      }
    }

    return await this.sendMessageWithTyping<AnyMessageContent>(
      data.number,
      {
        audio: isURL(data.audio) ? { url: data.audio } : Buffer.from(data.audio, 'base64'),
        ptt: true,
        mimetype: 'audio/ogg; codecs=opus',
      },
      { presence: 'recording', delay: data?.delay },
      isIntegration,
    );
  }

  private generateRandomId(length = 11) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  private toJSONString(button: Button): string {
    const toString = (obj: any) => JSON.stringify(obj);
    const amount = { value: Math.round((button.amount ?? 0) * 100), offset: 100 };

    const json = {
      call: () => toString({ display_text: button.displayText, phone_number: button.phoneNumber }),
      reply: () => toString({ display_text: button.displayText, id: button.id }),
      copy: () =>
        toString({
          display_text: button.displayText,
          copy_code: button.copyCode,
        }),
      url: () => toString({ display_text: button.displayText, url: button.url, merchant_url: button.url }),
      pix: () =>
        toString({
          currency: button.currency ?? 'BRL',
          total_amount: amount,
          reference_id: this.generateRandomId(),
          type: 'physical-goods',
          order: {
            status: 'pending',
            subtotal: amount,
            order_type: 'ORDER',
            items: [
              { name: amount.value ? button.name : '', amount, quantity: amount.value ? 1 : 0, sale_amount: amount },
            ],
          },
          payment_settings: [
            {
              type: 'pix_static_code',
              pix_static_code: {
                merchant_name: button.name,
                key: button.key,
                key_type: this.mapKeyType.get(button.keyType),
              },
            },
          ],
          share_payment_status: false,
        }),
    };

    return json[button.type]?.() || '';
  }

  private readonly mapType = new Map<TypeButton, string>([
    ['reply', 'quick_reply'],
    ['copy', 'cta_copy'],
    ['url', 'cta_url'],
    ['call', 'cta_call'],
    ['pix', 'payment_info'],
  ]);

  private readonly mapKeyType = new Map<KeyType, string>([
    ['phone', 'PHONE'],
    ['email', 'EMAIL'],
    ['cpf', 'CPF'],
    ['cnpj', 'CNPJ'],
    ['random', 'EVP'],
  ]);

  public async buttonMessage(data: SendButtonsDto) {
    if (!data.buttons?.length) {
      throw new BadRequestException('Informe pelo menos um botão');
    }

    const requiredFields: Record<TypeButton, (keyof Button)[]> = {
      reply: ['displayText', 'id'],
      copy: ['displayText', 'copyCode'],
      url: ['displayText', 'url'],
      call: ['displayText', 'phoneNumber'],
      pix: ['name', 'keyType', 'key'],
    };
    for (const button of data.buttons) {
      if (!requiredFields[button.type]) {
        throw new BadRequestException('Tipo de botão inválido');
      }
      if (requiredFields[button.type].some((field) => !button[field])) {
        throw new BadRequestException(`Dados incompletos para o botão ${button.type}`);
      }
    }

    const hasReplyButtons = data.buttons.some((btn) => btn.type === 'reply');
    const hasCopyButton = data.buttons.some((btn) => btn.type === 'copy');

    const hasPixButton = data.buttons.some((btn) => btn.type === 'pix');

    const hasOtherButtons = data.buttons.some((btn) => btn.type !== 'reply' && btn.type !== 'pix');

    if (hasReplyButtons) {
      if (data.buttons.length > 3) {
        throw new BadRequestException('Maximum of 3 reply buttons allowed');
      }
      if (hasOtherButtons) {
        throw new BadRequestException('Reply buttons cannot be mixed with other button types');
      }
    }

    if (hasPixButton) {
      if (data.buttons.length > 1) {
        throw new BadRequestException('Only one PIX button is allowed');
      }
      if (hasOtherButtons) {
        throw new BadRequestException('PIX button cannot be mixed with other button types');
      }

      const message: proto.IMessage = {
        interactiveMessage: {
          body: { text: [data.title || data.buttons[0].name, data.description].filter(Boolean).join('\n\n') },
          footer: data.footer ? { text: data.footer } : undefined,
          nativeFlowMessage: {
            buttons: [{ name: this.mapType.get('pix'), buttonParamsJson: this.toJSONString(data.buttons[0]) }],
            messageParamsJson: JSON.stringify({ from: 'api', templateId: v4() }),
          },
        },
      };

      return await this.sendMessageWithTyping(data.number, message, {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      });
    }

    const generate = await (async () => {
      if (data?.thumbnailUrl) {
        return await this.prepareMediaMessage({ mediatype: 'image', media: data.thumbnailUrl });
      }
    })();

    const buttons = data.buttons.map((value) => {
      return { name: this.mapType.get(value.type), buttonParamsJson: this.toJSONString(value) };
    });

    const message: proto.IMessage = {
      interactiveMessage: {
        body: {
          text: (() => {
            let t = '*' + data.title + '*';
            if (data?.description) {
              t += '\n\n';
              t += data.description;
              t += '\n';
            }
            return t;
          })(),
        },
        footer: { text: data?.footer },
        header: (() => {
          if (generate?.message?.imageMessage) {
            return {
              hasMediaAttachment: !!generate.message.imageMessage,
              imageMessage: generate.message.imageMessage,
            };
          }
        })(),
        nativeFlowMessage: {
          buttons: buttons,
          messageParamsJson: hasCopyButton ? '{}' : JSON.stringify({ from: 'api', templateId: v4() }),
          messageVersion: hasCopyButton ? 1 : undefined,
        },
      },
    };

    const fallbackText = buttonFallbackText(data);
    let interactiveResult: Awaited<ReturnType<typeof this.sendMessageWithTyping>>;
    try {
      interactiveResult = await this.sendMessageWithTyping(data.number, message, {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      });
    } catch (error) {
      if (!fallbackText) throw error;
      this.logger.warn(`Copy button could not be sent as an interactive message: ${error}`);
    }

    if (!fallbackText) return interactiveResult;

    // Native-flow copy buttons are not rendered by every WhatsApp client.
    // Send the same code as ordinary text so it remains visible and selectable everywhere.
    return await this.textMessage({ ...data, text: fallbackText, delay: 0 });
  }

  public async locationMessage(data: SendLocationDto) {
    return await this.sendMessageWithTyping(
      data.number,
      {
        locationMessage: {
          degreesLatitude: data.latitude,
          degreesLongitude: data.longitude,
          name: data?.name,
          address: data?.address,
        },
      },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
    );
  }

  public async listMessage(data: SendListDto) {
    if (data.sections.reduce((count, section) => count + section.rows.length, 0) > 10) {
      throw new BadRequestException('A lista pode ter no máximo 10 opções');
    }

    const message: proto.IMessage = {
      listMessage: {
        title: data.title || '',
        description: data.description?.trim() || 'Escolha uma opção na lista.',
        buttonText: data.buttonText || 'Ver opções',
        footerText: data.footerText || '',
        listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
        sections: data.sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            title: row.title,
            description: row.description,
            rowId: row.rowId,
          })),
        })),
      },
    };

    return await this.sendMessageWithTyping(data.number, message, {
      delay: data?.delay,
      presence: 'composing',
      quoted: data?.quoted,
      mentionsEveryOne: data?.mentionsEveryOne,
      mentioned: data?.mentioned,
    });
  }

  public async contactMessage(data: SendContactDto) {
    const message: proto.IMessage = {};

    const vcard = (contact: ContactMessage) => {
      let result = 'BEGIN:VCARD\n' + 'VERSION:3.0\n' + `N:${contact.fullName}\n` + `FN:${contact.fullName}\n`;

      if (contact.organization) {
        result += `ORG:${contact.organization};\n`;
      }

      if (contact.email) {
        result += `EMAIL:${contact.email}\n`;
      }

      if (contact.url) {
        result += `URL:${contact.url}\n`;
      }

      if (!contact.wuid) {
        contact.wuid = createJid(contact.phoneNumber);
      }

      result += `item1.TEL;waid=${contact.wuid}:${contact.phoneNumber}\n` + 'item1.X-ABLabel:Celular\n' + 'END:VCARD';

      return result;
    };

    if (data.contact.length === 1) {
      message.contactMessage = { displayName: data.contact[0].fullName, vcard: vcard(data.contact[0]) };
    } else {
      message.contactsArrayMessage = {
        displayName: `${data.contact.length} contacts`,
        contacts: data.contact.map((contact) => {
          return { displayName: contact.fullName, vcard: vcard(contact) };
        }),
      };
    }

    return await this.sendMessageWithTyping(data.number, { ...message }, {});
  }

  public async reactionMessage(data: SendReactionDto) {
    return await this.sendMessageWithTyping(data.key.remoteJid, {
      reactionMessage: { key: data.key, text: data.reaction },
    });
  }

  // Chat Controller
  public async whatsappNumber(data: WhatsAppNumberDto) {
    const jids: {
      groups: { number: string; jid: string }[];
      broadcast: { number: string; jid: string }[];
      users: { number: string; jid: string; name?: string }[];
    } = { groups: [], broadcast: [], users: [] };

    data.numbers.forEach((number) => {
      const jid = createJid(number);

      if (isJidGroup(jid)) {
        jids.groups.push({ number, jid });
      } else if (jid === 'status@broadcast') {
        jids.broadcast.push({ number, jid });
      } else {
        jids.users.push({ number, jid });
      }
    });

    const onWhatsapp: OnWhatsAppDto[] = [];

    // BROADCAST
    onWhatsapp.push(...jids.broadcast.map(({ jid, number }) => new OnWhatsAppDto(jid, false, number)));

    // GROUPS
    const groups = await Promise.all(
      jids.groups.map(async ({ jid, number }) => {
        const group = await this.findGroup({ groupJid: jid }, 'inner');

        if (!group) {
          return new OnWhatsAppDto(jid, false, number);
        }

        return new OnWhatsAppDto(group.id, true, number, group?.subject);
      }),
    );
    onWhatsapp.push(...groups);

    // USERS
    const contacts: any[] = await this.prismaRepository.contact.findMany({
      where: { instanceId: this.instanceId, remoteJid: { in: jids.users.map(({ jid }) => jid) } },
    });

    // Unified cache verification for all numbers (normal and LID)
    const numbersToVerify = jids.users.map(({ jid }) => jid.replace('+', ''));

    // Get all numbers from cache
    const cachedNumbers = await getOnWhatsappCache(numbersToVerify);

    // Separate numbers that are and are not in cache
    const cachedJids = new Set(cachedNumbers.flatMap((cached) => cached.jidOptions));
    const numbersNotInCache = numbersToVerify.filter((jid) => !cachedJids.has(jid));

    // Only call Baileys for normal numbers (@s.whatsapp.net) that are not in cache
    let verify: { jid: string; exists: boolean }[] = [];
    const normalNumbersNotInCache = numbersNotInCache.filter((jid) => !jid.includes('@lid'));

    if (normalNumbersNotInCache.length > 0) {
      this.logger.verbose(`Checking ${normalNumbersNotInCache.length} numbers via Baileys (not found in cache)`);
      verify = await this.client.onWhatsApp(...normalNumbersNotInCache);
    }

    const verifiedUsers = await Promise.all(
      jids.users.map(async (user) => {
        // Try to get from cache first (works for all: normal and LID)
        const cached = cachedNumbers.find((cached) => cached.jidOptions.includes(user.jid.replace('+', '')));

        if (cached) {
          this.logger.verbose(`Number ${user.number} found in cache`);
          return new OnWhatsAppDto(
            cached.remoteJid,
            true,
            user.number,
            contacts.find((c) => c.remoteJid === cached.remoteJid)?.pushName,
            cached.lid || (cached.remoteJid.includes('@lid') ? 'lid' : undefined),
          );
        }

        // If it's a LID number and not in cache, consider it valid
        if (user.jid.includes('@lid')) {
          return new OnWhatsAppDto(
            user.jid,
            true,
            user.number,
            contacts.find((c) => c.remoteJid === user.jid)?.pushName,
            'lid',
          );
        }

        // If not in cache and is a normal number, use Baileys verification
        let numberVerified: (typeof verify)[0] | null = null;

        // Brazilian numbers
        if (user.number.startsWith('55')) {
          const numberWithDigit =
            user.number.slice(4, 5) === '9' && user.number.length === 13
              ? user.number
              : `${user.number.slice(0, 4)}9${user.number.slice(4)}`;
          const numberWithoutDigit =
            user.number.length === 12 ? user.number : user.number.slice(0, 4) + user.number.slice(5);

          numberVerified = verify.find(
            (v) => v.jid === `${numberWithDigit}@s.whatsapp.net` || v.jid === `${numberWithoutDigit}@s.whatsapp.net`,
          );
        }

        // Mexican/Argentina numbers
        // Ref: https://faq.whatsapp.com/1294841057948784
        if (!numberVerified && (user.number.startsWith('52') || user.number.startsWith('54'))) {
          let prefix = '';
          if (user.number.startsWith('52')) {
            prefix = '1';
          }
          if (user.number.startsWith('54')) {
            prefix = '9';
          }

          const numberWithDigit =
            user.number.slice(2, 3) === prefix && user.number.length === 13
              ? user.number
              : `${user.number.slice(0, 2)}${prefix}${user.number.slice(2)}`;
          const numberWithoutDigit =
            user.number.length === 12 ? user.number : user.number.slice(0, 2) + user.number.slice(3);

          numberVerified = verify.find(
            (v) => v.jid === `${numberWithDigit}@s.whatsapp.net` || v.jid === `${numberWithoutDigit}@s.whatsapp.net`,
          );
        }

        if (!numberVerified) {
          numberVerified = verify.find((v) => v.jid === user.jid);
        }

        const numberJid = numberVerified?.jid || user.jid;

        return new OnWhatsAppDto(
          numberJid,
          !!numberVerified?.exists,
          user.number,
          contacts.find((c) => c.remoteJid === numberJid)?.pushName,
          undefined,
        );
      }),
    );

    // Combine results
    onWhatsapp.push(...verifiedUsers);

    // TODO: Salvar no cache apenas números que NÃO estavam no cache
    const numbersToCache = onWhatsapp.filter((user) => {
      if (!user.exists) return false;
      // Verifica se estava no cache usando jidOptions
      const cached = cachedNumbers?.find((cached) => cached.jidOptions.includes(user.jid.replace('+', '')));
      return !cached;
    });

    if (numbersToCache.length > 0) {
      this.logger.verbose(`Salvando ${numbersToCache.length} números no cache`);
      await saveOnWhatsappCache(
        numbersToCache.map((user) => ({
          remoteJid: user.jid,
          lid: user.lid === 'lid' ? 'lid' : undefined,
        })),
      );
    }

    return onWhatsapp;
  }

  public async markMessageAsRead(data: ReadMessageDto) {
    try {
      const keys: proto.IMessageKey[] = [];
      const remoteJids = new Set<string>();
      data.readMessages.forEach((read) => {
        if (isJidGroup(read.remoteJid) || isPnUser(read.remoteJid) || isLidUser(read.remoteJid)) {
          keys.push({ remoteJid: read.remoteJid, fromMe: read.fromMe, id: read.id });
          if (!read.fromMe) remoteJids.add(read.remoteJid);
        }
      });
      await this.client.readMessages(keys);

      await Promise.all(
        data.readMessages
          .filter((read) => !read.fromMe && remoteJids.has(read.remoteJid))
          .map(
            (read) =>
              this.prismaRepository.$executeRaw`
              UPDATE "Message"
              SET "status" = ${status[4]}
              WHERE "instanceId" = ${this.instanceId}
                AND "key"->>'id' = ${read.id}
                AND "key"->>'remoteJid' = ${read.remoteJid}
                AND "key"->>'fromMe' = 'false'
                AND ("status" IS NULL OR "status" IN (${status[2]}, ${status[3]}))
            `,
          ),
      );
      await Promise.all(Array.from(remoteJids, (remoteJid) => this.updateChatUnreadMessages(remoteJid)));

      return { message: 'Read messages', read: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Read messages fail', error.toString());
    }
  }

  public async getLastMessage(number: string) {
    const where: any = { key: { remoteJid: number }, instanceId: this.instance.id };

    const messages = await this.prismaRepository.message.findMany({
      where,
      orderBy: { messageTimestamp: 'desc' },
      take: 1,
    });

    if (messages.length === 0) {
      throw new NotFoundException('Messages not found');
    }

    let lastMessage = messages.pop();

    for (const message of messages) {
      if (message.messageTimestamp >= lastMessage.messageTimestamp) {
        lastMessage = message;
      }
    }

    return lastMessage as unknown as LastMessage;
  }

  public async archiveChat(data: ArchiveChatDto) {
    try {
      let last_message = data.lastMessage;
      let number = data.chat;

      if (!last_message && number) {
        last_message = await this.getLastMessage(number);
      } else {
        last_message = data.lastMessage;
        last_message.messageTimestamp = last_message?.messageTimestamp ?? Date.now();
        number = last_message?.key?.remoteJid;
      }

      if (!last_message || Object.keys(last_message).length === 0) {
        throw new NotFoundException('Last message not found');
      }

      await this.client.chatModify({ archive: data.archive, lastMessages: [last_message] }, createJid(number));

      return { chatId: number, archived: true };
    } catch (error) {
      throw new InternalServerErrorException({
        archived: false,
        message: ['An error occurred while archiving the chat. Open a calling.', error.toString()],
      });
    }
  }

  public async markChatUnread(data: MarkChatUnreadDto) {
    try {
      let last_message = data.lastMessage;
      let number = data.chat;

      if (!last_message && number) {
        last_message = await this.getLastMessage(number);
      } else {
        last_message = data.lastMessage;
        last_message.messageTimestamp = last_message?.messageTimestamp ?? Date.now();
        number = last_message?.key?.remoteJid;
      }

      if (!last_message || Object.keys(last_message).length === 0) {
        throw new NotFoundException('Last message not found');
      }

      await this.client.chatModify({ markRead: false, lastMessages: [last_message] }, createJid(number));

      return { chatId: number, markedChatUnread: true };
    } catch (error) {
      throw new InternalServerErrorException({
        markedChatUnread: false,
        message: ['An error occurred while marked unread the chat. Open a calling.', error.toString()],
      });
    }
  }

  public async forwardMessage(data: ForwardMessageDto) {
    const source = await this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        AND: [{ key: { path: ['id'], equals: data.id } }, { key: { path: ['remoteJid'], equals: data.remoteJid } }],
      },
    });
    if (!source || source.status === 'DELETED' || source.messageType === 'protocolMessage' || !source.message) {
      throw new BadRequestException('Mensagem indisponível para encaminhamento');
    }

    const forwarded = await this.client.sendMessage(createJid(data.number), {
      forward: {
        key: source.key as proto.IMessageKey,
        message: this.deserializeMessageBuffers(source.message) as proto.IMessage,
      },
    });

    if (!forwarded?.message || !forwarded.key?.id) {
      throw new BadRequestException('Não foi possível encaminhar a mensagem');
    }

    const messageRaw = this.prepareMessage(forwarded);
    if (this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
      const existing = await this.prismaRepository.message.findFirst({
        where: {
          instanceId: this.instanceId,
          AND: [
            { key: { path: ['id'], equals: forwarded.key.id } },
            { key: { path: ['remoteJid'], equals: forwarded.key.remoteJid } },
          ],
        },
      });
      if (!existing) {
        await this.prismaRepository.message.create({ data: messageRaw });
      }
    }

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);
    return messageRaw;
  }

  public async deleteMessage(del: DeleteMessage) {
    try {
      const response = await this.client.sendMessage(del.remoteJid, { delete: del });
      if (response) {
        const messageId = response.message?.protocolMessage?.key?.id;
        if (messageId) {
          const isLogicalDeleted = configService.get<Database>('DATABASE').DELETE_DATA.LOGICAL_MESSAGE_DELETE;
          let message = await this.prismaRepository.message.findFirst({
            where: { instanceId: this.instanceId, key: { path: ['id'], equals: messageId } },
          });
          if (isLogicalDeleted) {
            if (!message) return response;
            const existingKey = typeof message?.key === 'object' && message.key !== null ? message.key : {};
            message = await this.prismaRepository.message.update({
              where: { id: message.id },
              data: { key: { ...existingKey, deleted: true }, status: 'DELETED' },
            });
            if (this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) {
              const messageUpdate: any = {
                messageId: message.id,
                keyId: messageId,
                remoteJid: response.key.remoteJid,
                fromMe: response.key.fromMe,
                participant: response.key?.participant,
                status: 'DELETED',
                instanceId: this.instanceId,
              };
              await this.prismaRepository.messageUpdate.create({ data: messageUpdate });
            }
          } else {
            if (!message) return response;
            await this.prismaRepository.message.deleteMany({ where: { id: message.id } });
          }
          this.sendDataWebhook(Events.MESSAGES_DELETE, {
            id: message.id,
            instanceId: message.instanceId,
            key: message.key,
            messageType: message.messageType,
            status: 'DELETED',
            source: message.source,
            messageTimestamp: message.messageTimestamp,
            pushName: message.pushName,
            participant: message.participant,
            message: message.message,
          });
        }
      }

      return response;
    } catch (error) {
      throw new InternalServerErrorException('Error while deleting message for everyone', error?.toString());
    }
  }

  public async mapMediaType(mediaType) {
    const map = {
      imageMessage: 'image',
      videoMessage: 'video',
      documentMessage: 'document',
      stickerMessage: 'sticker',
      audioMessage: 'audio',
      ptvMessage: 'video',
    };
    return map[mediaType] || null;
  }

  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto, getBuffer = false) {
    try {
      const m = data?.message;
      const convertToMp4 = data?.convertToMp4 ?? false;

      const msg = m?.message ? m : ((await this.getMessage(m.key, true)) as proto.IWebMessageInfo);

      if (!msg) {
        throw 'Message not found';
      }

      // Album media can be wrapped by both associatedChildMessage and a
      // disappearing/view-once envelope. Unwrap each layer before downloading.
      for (let depth = 0; depth < 10; depth++) {
        const subtype = MessageSubtype.find((type) => msg.message?.[type]?.message);
        if (!subtype) break;
        msg.message = msg.message[subtype].message;
      }

      if ('messageContextInfo' in msg.message && Object.keys(msg.message).length === 1) {
        this.logger.verbose('Message contains only messageContextInfo, skipping media processing');
        return null;
      }

      let mediaMessage: any;
      let mediaType: string;

      if (msg.message?.templateMessage) {
        const template =
          msg.message.templateMessage.hydratedTemplate || msg.message.templateMessage.hydratedFourRowTemplate;

        for (const type of TypeMediaMessage) {
          if (template[type]) {
            mediaMessage = template[type];
            mediaType = type;
            msg.message = { [type]: { ...template[type], url: template[type].staticUrl } };
            break;
          }
        }

        if (!mediaMessage) {
          throw 'Template message does not contain a supported media type';
        }
      } else {
        for (const type of TypeMediaMessage) {
          mediaMessage = msg.message[type];
          if (mediaMessage) {
            mediaType = type;
            break;
          }
        }

        if (!mediaMessage) {
          throw 'The message is not of the media type';
        }
      }

      if (typeof mediaMessage['mediaKey'] === 'object') {
        msg.message[mediaType].mediaKey = Uint8Array.from(Object.values(mediaMessage['mediaKey']));
      }

      let buffer: Buffer;

      try {
        buffer = await downloadMediaMessage(
          { key: msg?.key, message: msg?.message },
          'buffer',
          {},
          { logger: P({ level: 'error' }) as any, reuploadRequest: this.client.updateMediaMessage },
        );
      } catch {
        this.logger.error('Download Media failed, trying to retry in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const mediaType = Object.keys(msg.message).find((key) => key.endsWith('Message'));
        if (!mediaType) throw new Error('Could not determine mediaType for fallback');

        try {
          const media = await downloadContentFromMessage(
            {
              mediaKey: msg.message?.[mediaType]?.mediaKey,
              directPath: msg.message?.[mediaType]?.directPath,
              url: `https://mmg.whatsapp.net${msg?.message?.[mediaType]?.directPath}`,
            },
            await this.mapMediaType(mediaType),
            {},
          );
          const chunks = [];
          for await (const chunk of media) {
            chunks.push(chunk);
          }
          buffer = Buffer.concat(chunks);
          this.logger.info('Download Media with downloadContentFromMessage was successful!');
        } catch (fallbackErr) {
          this.logger.error('Download Media with downloadContentFromMessage also failed!');
          throw fallbackErr;
        }
      }
      const typeMessage = getContentType(msg.message);

      const ext = mimeTypes.extension(mediaMessage?.['mimetype']);
      const fileName = mediaMessage?.['fileName'] || `${msg.key.id}.${ext}` || `${v4()}.${ext}`;

      if (convertToMp4 && typeMessage === 'audioMessage') {
        try {
          const convert = await this.processAudioMp4(buffer.toString('base64'));

          if (Buffer.isBuffer(convert)) {
            const result = {
              mediaType,
              fileName,
              caption: mediaMessage['caption'],
              size: {
                fileLength: mediaMessage['fileLength'],
                height: mediaMessage['height'],
                width: mediaMessage['width'],
              },
              mimetype: 'audio/mp4',
              base64: convert.toString('base64'),
              buffer: getBuffer ? convert : null,
            };

            return result;
          }
        } catch (error) {
          this.logger.error('Error converting audio to mp4:');
          this.logger.error(error);
          throw new BadRequestException('Failed to convert audio to MP4');
        }
      }

      return {
        mediaType,
        fileName,
        caption: mediaMessage['caption'],
        size: { fileLength: mediaMessage['fileLength'], height: mediaMessage['height'], width: mediaMessage['width'] },
        mimetype: mediaMessage['mimetype'],
        base64: buffer.toString('base64'),
        buffer: getBuffer ? buffer : null,
      };
    } catch (error) {
      this.logger.error('Error processing media message:');
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  public async fetchPrivacySettings() {
    const privacy = await this.client.fetchPrivacySettings();

    return {
      readreceipts: privacy.readreceipts,
      profile: privacy.profile,
      status: privacy.status,
      online: privacy.online,
      last: privacy.last,
      groupadd: privacy.groupadd,
    };
  }

  public async updatePrivacySettings(settings: PrivacySettingDto) {
    try {
      await this.client.updateReadReceiptsPrivacy(settings.readreceipts);
      await this.client.updateProfilePicturePrivacy(settings.profile);
      await this.client.updateStatusPrivacy(settings.status);
      await this.client.updateOnlinePrivacy(settings.online);
      await this.client.updateLastSeenPrivacy(settings.last);
      await this.client.updateGroupsAddPrivacy(settings.groupadd);

      this.reloadConnection();

      return {
        update: 'success',
        data: {
          readreceipts: settings.readreceipts,
          profile: settings.profile,
          status: settings.status,
          online: settings.online,
          last: settings.last,
          groupadd: settings.groupadd,
        },
      };
    } catch (error) {
      throw new InternalServerErrorException('Error updating privacy settings', error.toString());
    }
  }

  public async fetchBusinessProfile(number: string): Promise<NumberBusiness> {
    try {
      const jid = number ? createJid(number) : this.instance.wuid;

      const profile = await this.client.getBusinessProfile(jid);

      if (!profile) {
        const info = await this.whatsappNumber({ numbers: [jid] });

        return { isBusiness: false, message: 'Not is business profile', ...info?.shift() };
      }

      return { isBusiness: true, ...profile };
    } catch (error) {
      throw new InternalServerErrorException('Error updating profile name', error.toString());
    }
  }

  public async updateProfileName(name: string) {
    try {
      await this.client.updateProfileName(name);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating profile name', error.toString());
    }
  }

  public async updateProfileStatus(status: string) {
    try {
      await this.client.updateProfileStatus(status);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating profile status', error.toString());
    }
  }

  public async updateProfilePicture(picture: string) {
    try {
      let pic: WAMediaUpload;
      if (isURL(picture)) {
        const timestamp = new Date().getTime();
        const parsedURL = new URL(picture);
        parsedURL.searchParams.set('timestamp', timestamp.toString());
        const url = parsedURL.toString();

        let config: any = { responseType: 'arraybuffer' };

        if (this.localProxy?.enabled) {
          config = {
            ...config,
            httpsAgent: makeProxyAgent({
              host: this.localProxy.host,
              port: this.localProxy.port,
              protocol: this.localProxy.protocol,
              username: this.localProxy.username,
              password: this.localProxy.password,
            }),
          };
        }

        pic = (await axios.get(url, config)).data;
      } else if (isBase64(picture)) {
        pic = Buffer.from(picture, 'base64');
      } else {
        throw new BadRequestException('"profilePicture" must be a url or a base64');
      }

      await this.client.updateProfilePicture(this.instance.wuid, pic);

      this.reloadConnection();

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating profile picture', error.toString());
    }
  }

  public async removeProfilePicture() {
    try {
      await this.client.removeProfilePicture(this.instance.wuid);

      this.reloadConnection();

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error removing profile picture', error.toString());
    }
  }

  public async blockUser(data: BlockUserDto) {
    try {
      const { number } = data;

      const isWA = (await this.whatsappNumber({ numbers: [number] }))?.shift();

      if (!isWA.exists && !isJidGroup(isWA.jid) && !isWA.jid.includes('@broadcast')) {
        throw new BadRequestException(isWA);
      }

      const sender = isWA.jid;

      await this.client.updateBlockStatus(sender, data.status);

      return { block: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error blocking user', error.toString());
    }
  }

  private async formatUpdateMessage(data: UpdateMessageDto) {
    try {
      if (!this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
        return data;
      }

      const msg: any = await this.getMessage(data.key, true);

      if (msg?.messageType === 'conversation' || msg?.messageType === 'extendedTextMessage') {
        return { text: data.text };
      }

      if (msg?.messageType === 'imageMessage') {
        return { image: msg?.message?.imageMessage, caption: data.text };
      }

      if (msg?.messageType === 'videoMessage') {
        return { video: msg?.message?.videoMessage, caption: data.text };
      }

      return null;
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  public async updateMessage(data: UpdateMessageDto) {
    const jid = createJid(data.number);

    const options = await this.formatUpdateMessage(data);

    if (!options) {
      this.logger.error('Message not compatible');
      throw new BadRequestException('Message not compatible');
    }

    try {
      const oldMessage: any = await this.getMessage(data.key, true);
      if (this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
        if (!oldMessage) throw new NotFoundException('Message not found');
        if (oldMessage?.key?.remoteJid !== jid) {
          throw new BadRequestException('RemoteJid does not match');
        }
        if (oldMessage?.messageTimestamp > Date.now() + 900000) {
          // 15 minutes in milliseconds
          throw new BadRequestException('Message is older than 15 minutes');
        }
      }

      const messageSent = await this.client.sendMessage(jid, { ...(options as any), edit: data.key });
      if (messageSent) {
        const editedMessage =
          messageSent?.message?.protocolMessage || messageSent?.message?.editedMessage?.message?.protocolMessage;

        if (editedMessage) {
          this.sendDataWebhook(Events.SEND_MESSAGE_UPDATE, editedMessage);
          if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled)
            this.chatwootService.eventWhatsapp(
              'send.message.update',
              { instanceName: this.instance.name, instanceId: this.instance.id },
              editedMessage,
            );

          const messageId = messageSent.message?.protocolMessage?.key?.id;
          if (messageId && this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
            let message = await this.prismaRepository.message.findFirst({
              where: { key: { path: ['id'], equals: messageId } },
            });
            if (!message) throw new NotFoundException('Message not found');

            if (!(message.key.valueOf() as any).fromMe) {
              new BadRequestException('You cannot edit others messages');
            }
            if ((message.key.valueOf() as any)?.deleted) {
              new BadRequestException('You cannot edit deleted messages');
            }

            if (oldMessage.messageType === 'conversation' || oldMessage.messageType === 'extendedTextMessage') {
              oldMessage.message.conversation = data.text;
            } else {
              oldMessage.message[oldMessage.messageType].caption = data.text;
            }
            message = await this.prismaRepository.message.update({
              where: { id: message.id },
              data: {
                message: oldMessage.message,
                status: 'EDITED',
                messageTimestamp: Math.floor(Date.now() / 1000), // Convert to int32 by dividing by 1000 to get seconds
              },
            });

            if (this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) {
              const messageUpdate: any = {
                messageId: message.id,
                keyId: messageId,
                remoteJid: messageSent.key.remoteJid,
                fromMe: messageSent.key.fromMe,
                participant: messageSent.key?.participant,
                status: 'EDITED',
                instanceId: this.instanceId,
              };
              await this.prismaRepository.messageUpdate.create({ data: messageUpdate });
            }
          }
        }
      }

      return messageSent;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  public async fetchLabels(): Promise<LabelDto[]> {
    const labels = await this.prismaRepository.label.findMany({ where: { instanceId: this.instanceId } });

    return labels.map((label) => ({
      color: label.color,
      name: label.name,
      id: label.labelId,
      predefinedId: label.predefinedId,
    }));
  }

  public async handleLabel(data: HandleLabelDto) {
    const whatsappContact = await this.whatsappNumber({ numbers: [data.number] });
    if (whatsappContact.length === 0) {
      throw new NotFoundException('Number not found');
    }
    const contact = whatsappContact[0];
    if (!contact.exists) {
      throw new NotFoundException('Number is not on WhatsApp');
    }

    try {
      if (data.action === 'add') {
        await this.client.addChatLabel(contact.jid, data.labelId);
        await this.addLabel(data.labelId, this.instanceId, contact.jid);

        return { numberJid: contact.jid, labelId: data.labelId, add: true };
      }
      if (data.action === 'remove') {
        await this.client.removeChatLabel(contact.jid, data.labelId);
        await this.removeLabel(data.labelId, this.instanceId, contact.jid);

        return { numberJid: contact.jid, labelId: data.labelId, remove: true };
      }
    } catch (error) {
      throw new BadRequestException(`Unable to ${data.action} label to chat`, error.toString());
    }
  }

  // Group
  private async saveGroupSubjects(groups: Partial<GroupMetadata>[]) {
    await Promise.all(
      groups
        .filter((group) => group.id && isJidGroup(group.id) && group.subject?.trim())
        .map((group) =>
          this.prismaRepository.chat.upsert({
            where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: group.id } },
            create: { instanceId: this.instanceId, remoteJid: group.id, name: group.subject.trim() },
            update: { name: group.subject.trim() },
          }),
        ),
    );
  }

  public async fetchChats(query: any) {
    const chats = await super.fetchChats(query);
    const missingGroups = chats
      .filter(
        (chat) =>
          isJidGroup(chat.remoteJid) &&
          !chat.pushName?.trim() &&
          (this.groupNameLookupRetryAt.get(chat.remoteJid) || 0) < Date.now(),
      )
      .slice(0, 10);

    await Promise.all(
      missingGroups.map(async (chat) => {
        this.groupNameLookupRetryAt.set(chat.remoteJid, Date.now() + 5 * 60_000);
        try {
          const metadata = await this.getGroupMetadataCache(chat.remoteJid);
          if (!metadata?.subject?.trim()) return;
          chat.pushName = metadata.subject.trim();
          await this.saveGroupSubjects([metadata]);
          this.groupNameLookupRetryAt.delete(chat.remoteJid);
        } catch (error) {
          this.logger.error(error);
        }
      }),
    );

    return chats;
  }

  private async updateGroupMetadataCache(groupJid: string) {
    try {
      const meta = await this.client.groupMetadata(groupJid);

      const cacheConf = this.configService.get<CacheConf>('CACHE');

      if ((cacheConf?.REDIS?.ENABLED && cacheConf?.REDIS?.URI !== '') || cacheConf?.LOCAL?.ENABLED) {
        this.logger.verbose(`Updating cache for group: ${groupJid}`);
        await groupMetadataCache.set(groupJid, { timestamp: Date.now(), data: meta });
      }

      return meta;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  private getGroupMetadataCache = async (groupJid: string) => {
    if (!isJidGroup(groupJid)) return null;

    const cacheConf = this.configService.get<CacheConf>('CACHE');

    if ((cacheConf?.REDIS?.ENABLED && cacheConf?.REDIS?.URI !== '') || cacheConf?.LOCAL?.ENABLED) {
      if (await groupMetadataCache?.has(groupJid)) {
        console.log(`Cache request for group: ${groupJid}`);
        const meta = await groupMetadataCache.get(groupJid);

        if (Date.now() - meta.timestamp > 3600000) {
          return (await this.updateGroupMetadataCache(groupJid)) || meta.data;
        }

        return meta.data;
      }

      console.log(`Cache request for group: ${groupJid} - not found`);
      return await this.updateGroupMetadataCache(groupJid);
    }

    return await this.findGroup({ groupJid }, 'inner');
  };

  public async createGroup(create: CreateGroupDto) {
    try {
      const participants = (await this.whatsappNumber({ numbers: create.participants }))
        .filter((participant) => participant.exists)
        .map((participant) => participant.jid);
      const { id } = await this.client.groupCreate(create.subject, participants);

      if (create?.description) {
        await this.client.groupUpdateDescription(id, create.description);
      }

      if (create?.promoteParticipants) {
        await this.updateGParticipant({ groupJid: id, action: 'promote', participants: participants });
      }

      const group = await this.client.groupMetadata(id);

      return group;
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('Error creating group', error.toString());
    }
  }

  public async updateGroupPicture(picture: GroupPictureDto) {
    try {
      let pic: WAMediaUpload;
      if (isURL(picture.image)) {
        const timestamp = new Date().getTime();
        const parsedURL = new URL(picture.image);
        parsedURL.searchParams.set('timestamp', timestamp.toString());
        const url = parsedURL.toString();

        let config: any = { responseType: 'arraybuffer' };

        if (this.localProxy?.enabled) {
          config = {
            ...config,
            httpsAgent: makeProxyAgent({
              host: this.localProxy.host,
              port: this.localProxy.port,
              protocol: this.localProxy.protocol,
              username: this.localProxy.username,
              password: this.localProxy.password,
            }),
          };
        }

        pic = (await axios.get(url, config)).data;
      } else if (isBase64(picture.image)) {
        pic = Buffer.from(picture.image, 'base64');
      } else {
        throw new BadRequestException('"profilePicture" must be a url or a base64');
      }
      await this.client.updateProfilePicture(picture.groupJid, pic);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error update group picture', error.toString());
    }
  }

  public async updateGroupSubject(data: GroupSubjectDto) {
    try {
      await this.client.groupUpdateSubject(data.groupJid, data.subject);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating group subject', error.toString());
    }
  }

  public async updateGroupDescription(data: GroupDescriptionDto) {
    try {
      await this.client.groupUpdateDescription(data.groupJid, data.description);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating group description', error.toString());
    }
  }

  public async findGroup(id: GroupJid, reply: 'inner' | 'out' = 'out') {
    try {
      const group = await this.client.groupMetadata(id.groupJid);

      if (!group) {
        this.logger.error('Group not found');
        return null;
      }

      const picture = await this.profilePicture(group.id);

      return {
        id: group.id,
        subject: group.subject,
        subjectOwner: group.subjectOwner,
        subjectTime: group.subjectTime,
        pictureUrl: picture.profilePictureUrl,
        size: group.participants.length,
        creation: group.creation,
        owner: group.owner,
        desc: group.desc,
        descId: group.descId,
        restrict: group.restrict,
        announce: group.announce,
        participants: group.participants,
        isCommunity: group.isCommunity,
        isCommunityAnnounce: group.isCommunityAnnounce,
        linkedParent: group.linkedParent,
      };
    } catch (error) {
      if (reply === 'inner') {
        return;
      }
      throw new NotFoundException('Error fetching group', error.toString());
    }
  }

  public async fetchAllGroups(getParticipants: GetParticipant) {
    const fetch = Object.values(await this?.client?.groupFetchAllParticipating());

    let groups = [];
    for (const group of fetch) {
      const picture = await this.profilePicture(group.id);

      const result = {
        id: group.id,
        subject: group.subject,
        subjectOwner: group.subjectOwner,
        subjectTime: group.subjectTime,
        pictureUrl: picture?.profilePictureUrl,
        size: group.participants.length,
        creation: group.creation,
        owner: group.owner,
        desc: group.desc,
        descId: group.descId,
        restrict: group.restrict,
        announce: group.announce,
        isCommunity: group.isCommunity,
        isCommunityAnnounce: group.isCommunityAnnounce,
        linkedParent: group.linkedParent,
      };

      if (getParticipants.getParticipants == 'true') {
        result['participants'] = group.participants;
      }

      groups = [...groups, result];
    }

    return groups;
  }

  public async inviteCode(id: GroupJid) {
    try {
      const code = await this.client.groupInviteCode(id.groupJid);
      return { inviteUrl: `https://chat.whatsapp.com/${code}`, inviteCode: code };
    } catch (error) {
      throw new NotFoundException('No invite code', error.toString());
    }
  }

  public async inviteInfo(id: GroupInvite) {
    try {
      return await this.client.groupGetInviteInfo(id.inviteCode);
    } catch {
      throw new NotFoundException('No invite info', id.inviteCode);
    }
  }

  public async sendInvite(id: GroupSendInvite) {
    try {
      const inviteCode = await this.inviteCode({ groupJid: id.groupJid });

      const inviteUrl = inviteCode.inviteUrl;

      const numbers = id.numbers.map((number) => createJid(number));
      const description = id.description ?? '';

      const msg = `${description}\n\n${inviteUrl}`;

      const message = { conversation: msg };

      for await (const number of numbers) {
        await this.sendMessageWithTyping(number, message);
      }

      return { send: true, inviteUrl };
    } catch {
      throw new NotFoundException('No send invite');
    }
  }

  public async acceptInviteCode(id: AcceptGroupInvite) {
    try {
      const groupJid = await this.client.groupAcceptInvite(id.inviteCode);
      return { accepted: true, groupJid: groupJid };
    } catch (error) {
      throw new NotFoundException('Accept invite error', error.toString());
    }
  }

  public async revokeInviteCode(id: GroupJid) {
    try {
      const inviteCode = await this.client.groupRevokeInvite(id.groupJid);
      return { revoked: true, inviteCode };
    } catch (error) {
      throw new NotFoundException('Revoke error', error.toString());
    }
  }

  public async findParticipants(id: GroupJid) {
    try {
      const participants = (await this.client.groupMetadata(id.groupJid)).participants;
      const normalizeJid = (jid: string) => jid.replace(/:\d+(?=@)/, '');
      const asPhoneJid = (jid?: string) => {
        if (!jid) return undefined;
        const normalized = normalizeJid(jid);
        return normalized.includes('@') ? normalized : `${normalized}@s.whatsapp.net`;
      };
      const meaningfulName = (name?: string) => {
        const value = name?.trim();
        return value && !/^\+?\d[\d\s().:-]*$/.test(value) ? value : undefined;
      };
      const participantPhoneJids = new Map<string, string>();
      await Promise.all(
        participants.map(async (participant) => {
          const normalizedId = normalizeJid(participant.id);
          const providedPhoneJid = asPhoneJid(participant.phoneNumber);
          if (providedPhoneJid?.endsWith('@s.whatsapp.net')) {
            participantPhoneJids.set(participant.id, providedPhoneJid);
            return;
          }
          if (!normalizedId.endsWith('@lid')) return;
          try {
            const phoneJid = await this.client.signalRepository.lidMapping.getPNForLID(normalizedId);
            if (phoneJid) participantPhoneJids.set(participant.id, normalizeJid(phoneJid));
          } catch {
            // Keep the LID when WhatsApp has no phone number mapping.
          }
        }),
      );
      const participantJids = participants
        .flatMap((participant) => [
          participant.id,
          normalizeJid(participant.id),
          participant.lid,
          participant.lid ? normalizeJid(participant.lid) : undefined,
          participantPhoneJids.get(participant.id),
        ])
        .filter((jid): jid is string => Boolean(jid));
      const participantLids = new Map<string, string>();
      await Promise.all(
        [...new Set(participantJids)].map(async (jid) => {
          const normalized = normalizeJid(jid);
          if (!normalized.endsWith('@s.whatsapp.net')) return;
          try {
            const lid = await this.client.signalRepository.lidMapping.getLIDForPN(normalized);
            if (lid) participantLids.set(normalized, normalizeJid(lid));
          } catch {
            // Some participants have no LID mapping yet.
          }
        }),
      );
      const contacts = await this.prismaRepository.contact.findMany({
        where: {
          instanceId: this.instanceId,
          remoteJid: { in: [...new Set([...participantJids, ...participantLids.values()])] },
        },
      });
      const contactsByJid = new Map(contacts.map((contact) => [contact.remoteJid, contact]));
      const parsedParticipants = participants.map((participant) => {
        const phoneJid = participantPhoneJids.get(participant.id);
        const matchingContacts = [
          participant.id,
          normalizeJid(participant.id),
          participant.lid,
          phoneJid,
          participantLids.get(normalizeJid(phoneJid || participant.id)),
        ]
          .filter((jid): jid is string => Boolean(jid))
          .map((jid) => contactsByJid.get(normalizeJid(jid)))
          .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
        return {
          ...participant,
          customName: matchingContacts.map((contact) => meaningfulName(contact.customName)).find(Boolean),
          pushName:
            matchingContacts.map((contact) => meaningfulName(contact.pushName)).find(Boolean) ||
            meaningfulName(participant.notify),
          name:
            matchingContacts.map((contact) => meaningfulName(contact.customName)).find(Boolean) ||
            matchingContacts.map((contact) => meaningfulName(contact.pushName)).find(Boolean) ||
            meaningfulName(participant.name) ||
            meaningfulName(participant.notify) ||
            meaningfulName(participant.verifiedName),
          phoneNumber: phoneJid ? phoneJid.split('@')[0] : participant.phoneNumber,
          imgUrl: participant.imgUrl ?? matchingContacts.map((contact) => contact.profilePicUrl).find(Boolean),
        };
      });

      const usersContacts = parsedParticipants.filter((c) => c.id.includes('@s.whatsapp'));
      if (usersContacts) {
        await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.id })));
      }

      return { participants: parsedParticipants };
    } catch (error) {
      console.error(error);
      throw new NotFoundException('No participants', error.toString());
    }
  }

  private isUsefulGroupSenderName(name?: string | null): name is string {
    const value = name?.trim();
    return Boolean(value && !/^\+?\d[\d\s().:-]*$/.test(value) && !/@(?:lid|s\.whatsapp\.net)$/i.test(value));
  }

  private async saveGroupSenderPushName(message: WAMessage): Promise<void> {
    if (
      !this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS ||
      !isJidGroup(message.key.remoteJid) ||
      message.key.fromMe ||
      !this.isUsefulGroupSenderName(message.pushName)
    ) {
      return;
    }

    const key = message.key as typeof message.key & { participantAlt?: string };
    const jids = new Set(
      [key.participant, key.participantAlt, message.participant]
        .filter((jid): jid is string => Boolean(jid))
        .map((jid) => jid.replace(/:\d+(?=@)/, '')),
    );
    for (const jid of [...jids]) {
      if (!jid.endsWith('@lid')) continue;
      try {
        const phoneJid = await this.client.signalRepository.lidMapping.getPNForLID(jid);
        if (phoneJid) jids.add(phoneJid.replace(/:\d+(?=@)/, ''));
      } catch {
        // The LID remains usable when WhatsApp has no phone mapping.
      }
    }

    try {
      await Promise.all(
        [...jids].map((remoteJid) =>
          this.prismaRepository.contact.upsert({
            where: { remoteJid_instanceId: { remoteJid, instanceId: this.instanceId } },
            create: { remoteJid, instanceId: this.instanceId, pushName: message.pushName.trim() },
            update: { pushName: message.pushName.trim() },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(`Unable to save group sender pushName: ${error}`);
    }
  }

  private async resolveGroupMessageSenderName(
    message: WAMessage,
    fallbackName?: string | null,
  ): Promise<string | null> {
    const key = message.key as typeof message.key & { participantAlt?: string };
    const candidates = [
      ...new Set([key.participant, key.participantAlt, (message as any).participant].filter(Boolean)),
    ] as string[];
    if (!candidates.length) return fallbackName || null;

    const normalizeJid = (jid: string) => jid.replace(/:\d+(?=@)/, '');
    const mappedJids = new Map<string, string>();
    for (const candidate of candidates) {
      const normalized = normalizeJid(candidate);
      mappedJids.set(candidate, normalized);
      if (normalized.endsWith('@lid')) {
        try {
          const phoneJid = await this.client.signalRepository.lidMapping.getPNForLID(normalized);
          if (phoneJid) mappedJids.set(candidate, normalizeJid(phoneJid));
        } catch {
          // Use the LID if WhatsApp has no phone number mapping.
        }
      }
    }

    const lookupJids = [...new Set([...mappedJids.values(), ...candidates])];
    try {
      const contacts = await this.prismaRepository.contact.findMany({
        where: { instanceId: this.instanceId, remoteJid: { in: lookupJids } },
        select: { remoteJid: true, customName: true, pushName: true },
      });
      const meaningfulName = (name?: string | null) => {
        const value = name?.trim();
        return value && !/^\+?\d[\d\s().:-]*$/.test(value) ? value : undefined;
      };
      const contactName =
        contacts.map((contact) => meaningfulName(contact.customName)).find(Boolean) ||
        contacts.map((contact) => meaningfulName(contact.pushName)).find(Boolean);
      if (contactName) return contactName;
    } catch (error) {
      this.logger.warn(`Unable to resolve group message sender contact: ${error}`);
    }

    const numericFallback = candidates.some((jid) => {
      const bareJid = normalizeJid(jid).split('@')[0];
      return fallbackName === jid || fallbackName === jid.split('@')[0] || fallbackName === bareJid;
    });
    if (fallbackName && !numericFallback && !/^\+?\d[\d\s().:-]*$/.test(fallbackName)) return fallbackName;

    try {
      const groupJid = key.remoteJid!;
      const metadata = await this.getGroupMetadataCache(groupJid);
      const participant = metadata?.participants?.find((item) => {
        const participantIds = [item.id, item.lid, item.phoneNumber].filter(Boolean).map(normalizeJid);
        return candidates.some((candidate) => {
          const normalized = mappedJids.get(candidate) || normalizeJid(candidate);
          return participantIds.includes(normalized) || participantIds.includes(normalizeJid(candidate));
        });
      });
      const phoneJid = participant?.phoneNumber;
      if (phoneJid) {
        const normalizedPhoneJid = normalizeJid(phoneJid);
        const contact = await this.prismaRepository.contact.findFirst({
          where: {
            instanceId: this.instanceId,
            remoteJid: normalizedPhoneJid.includes('@') ? normalizedPhoneJid : `${normalizedPhoneJid}@s.whatsapp.net`,
          },
          select: { customName: true, pushName: true },
        });
        const contactName = [contact?.customName, contact?.pushName]
          .map((name) => name?.trim())
          .find((name) => name && !/^\+?\d[\d\s().:-]*$/.test(name));
        if (contactName) return contactName;
      }
      const metadataName = [participant?.name, participant?.notify, participant?.verifiedName]
        .map((name) => name?.trim())
        .find((name) => name && !/^\+?\d[\d\s().:-]*$/.test(name));
      if (metadataName) return metadataName;
    } catch (error) {
      this.logger.warn(`Unable to resolve group message sender metadata: ${error}`);
    }

    return candidates.map((jid) => normalizeJid(jid).split('@')[0]).find(Boolean) || fallbackName || null;
  }

  public async updateGParticipant(update: GroupUpdateParticipantDto) {
    try {
      const participants = update.participants.map((p) => createJid(p));
      const updateParticipants = await this.client.groupParticipantsUpdate(
        update.groupJid,
        participants,
        update.action,
      );
      return { updateParticipants: updateParticipants };
    } catch (error) {
      throw new BadRequestException('Error updating participants', error.toString());
    }
  }

  public async updateGSetting(update: GroupUpdateSettingDto) {
    try {
      const updateSetting = await this.client.groupSettingUpdate(update.groupJid, update.action);
      return { updateSetting: updateSetting };
    } catch (error) {
      throw new BadRequestException('Error updating setting', error.toString());
    }
  }

  public async toggleEphemeral(update: GroupToggleEphemeralDto) {
    try {
      await this.client.groupToggleEphemeral(update.groupJid, update.expiration);
      return { success: true };
    } catch (error) {
      throw new BadRequestException('Error updating setting', error.toString());
    }
  }

  public async leaveGroup(id: GroupJid) {
    try {
      await this.client.groupLeave(id.groupJid);
      return { groupJid: id.groupJid, leave: true };
    } catch (error) {
      throw new BadRequestException('Unable to leave the group', error.toString());
    }
  }

  public async deleteGroup(id: GroupJid) {
    try {
      const metadata = await this.client.groupMetadata(id.groupJid);
      const ownJid = jidNormalizedUser(this.client.user.id);
      const ownPn = isLidUser(ownJid) ? await this.client.signalRepository.lidMapping.getPNForLID(ownJid) : ownJid;
      const ownLid = ownPn ? await this.client.signalRepository.lidMapping.getLIDForPN(ownPn) : undefined;
      const ownIds = new Set([ownJid, ownPn, ownLid].filter(Boolean).map((jid) => jidNormalizedUser(jid)));
      const selfParticipant = metadata.participants.find((participant) =>
        ownIds.has(jidNormalizedUser(participant.id)),
      );

      if (!selfParticipant || !selfParticipant.admin) {
        throw new BadRequestException('Only group admins can delete a group');
      }

      const participantsToRemove = metadata.participants
        .filter((participant) => !ownIds.has(jidNormalizedUser(participant.id)))
        .map((participant) => participant.id);

      if (participantsToRemove.length) {
        const removals = await this.client.groupParticipantsUpdate(id.groupJid, participantsToRemove, 'remove');
        const failedRemovals = removals.filter((result) => String(result.status) !== '200');
        if (failedRemovals.length) {
          throw new BadRequestException('Unable to remove all participants from the group');
        }
      }
      await this.client.groupLeave(id.groupJid);
      return { groupJid: id.groupJid, delete: true };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Unable to delete the group', error.toString());
    }
  }

  public async templateMessage() {
    throw new Error('Method not available in the Baileys service');
  }

  private deserializeMessageBuffers(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'object' && !Array.isArray(obj) && !Buffer.isBuffer(obj)) {
      const keys = Object.keys(obj);
      const isIndexedObject = keys.every((key) => !isNaN(Number(key)));

      if (isIndexedObject && keys.length > 0) {
        const values = keys.sort((a, b) => Number(a) - Number(b)).map((key) => obj[key]);
        return new Uint8Array(values);
      }
    }

    // Is Buffer?, converter to Uint8Array
    if (Buffer.isBuffer(obj)) {
      return new Uint8Array(obj);
    }

    // Process arrays recursively
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deserializeMessageBuffers(item));
    }

    // Process objects recursively
    if (typeof obj === 'object') {
      const converted: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          converted[key] = this.deserializeMessageBuffers(obj[key]);
        }
      }
      return converted;
    }

    return obj;
  }

  private prepareMessage(message: proto.IWebMessageInfo): any {
    const contentType = getContentType(message.message);
    const contentMsg = message?.message[contentType] as any;

    const messageRaw = {
      key: message.key, // Save key exactly as it comes from Baileys
      pushName:
        message.pushName ||
        (message.key.fromMe
          ? 'Você'
          : message?.participant || (message.key?.participant ? message.key.participant.split('@')[0] : null)),
      status: status[message.status],
      message: this.deserializeMessageBuffers({ ...message.message }),
      contextInfo: this.deserializeMessageBuffers(contentMsg?.contextInfo),
      messageType: contentType || 'unknown',
      messageTimestamp: Long.isLong(message.messageTimestamp)
        ? message.messageTimestamp.toNumber()
        : (message.messageTimestamp as number),
      instanceId: this.instanceId,
      source: getDevice(message.key.id),
    };

    if (!messageRaw.status && message.key.fromMe === false) {
      messageRaw.status = status[3]; // DELIVERED MESSAGE
    }

    if (messageRaw.message.extendedTextMessage) {
      messageRaw.messageType = 'conversation';
      messageRaw.message.conversation = messageRaw.message.extendedTextMessage.text;
      delete messageRaw.message.extendedTextMessage;
    }

    if (messageRaw.message.documentWithCaptionMessage) {
      messageRaw.messageType = 'documentMessage';
      messageRaw.message.documentMessage = messageRaw.message.documentWithCaptionMessage.message.documentMessage;
      delete messageRaw.message.documentWithCaptionMessage;
    }

    const quotedMessage = messageRaw?.contextInfo?.quotedMessage;
    if (quotedMessage) {
      if (quotedMessage.extendedTextMessage) {
        quotedMessage.conversation = quotedMessage.extendedTextMessage.text;
        delete quotedMessage.extendedTextMessage;
      }

      if (quotedMessage.documentWithCaptionMessage) {
        quotedMessage.documentMessage = quotedMessage.documentWithCaptionMessage.message.documentMessage;
        delete quotedMessage.documentWithCaptionMessage;
      }
    }

    return messageRaw;
  }

  private async syncChatwootLostMessages() {
    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      const chatwootConfig = await this.findChatwoot();
      const prepare = (message: any) => this.prepareMessage(message);
      this.chatwootService.syncLostMessages({ instanceName: this.instance.name }, chatwootConfig, prepare);

      // Generate ID for this cron task and store in cache
      const cronId = cuid();
      const cronKey = `chatwoot:syncLostMessages`;
      await this.chatwootService.getCache()?.hSet(cronKey, this.instance.name, cronId);

      const task = cron.schedule('0,30 * * * *', async () => {
        // Check ID before executing (only if cache is available)
        const cache = this.chatwootService.getCache();
        if (cache) {
          const storedId = await cache.hGet(cronKey, this.instance.name);
          if (storedId && storedId !== cronId) {
            this.logger.info(`Stopping syncChatwootLostMessages cron - ID mismatch: ${cronId} vs ${storedId}`);
            task.stop();
            return;
          }
        }
        this.chatwootService.syncLostMessages({ instanceName: this.instance.name }, chatwootConfig, prepare);
      });
      task.start();
    }
  }

  private async updateMessagesReadedByTimestamp(remoteJid: string, timestamp?: number): Promise<number> {
    if (timestamp === undefined || timestamp === null) return 0;

    // Use raw SQL to avoid JSON path issues
    const result = await this.prismaRepository.$executeRaw`
      UPDATE "Message"
      SET "status" = ${status[4]}
      WHERE "instanceId" = ${this.instanceId}
      AND "key"->>'remoteJid' = ${remoteJid}
      AND ("key"->>'fromMe')::boolean = false
      AND "messageTimestamp" <= ${timestamp}
      AND ("status" IS NULL OR "status" = ${status[3]})
    `;

    if (result) {
      if (result > 0) {
        this.updateChatUnreadMessages(remoteJid);
      }

      return result;
    }

    return 0;
  }

  private async updateChatUnreadMessages(remoteJid: string): Promise<number> {
    const [chat, unreadMessages] = await Promise.all([
      this.prismaRepository.chat.findFirst({ where: { instanceId: this.instanceId, remoteJid } }),
      // Use raw SQL to avoid JSON path issues
      this.prismaRepository.$queryRaw`
        SELECT COUNT(*)::int as count FROM "Message"
        WHERE "instanceId" = ${this.instanceId}
        AND "key"->>'remoteJid' = ${remoteJid}
        AND ("key"->>'fromMe')::boolean = false
        AND "status" = ${status[3]}
      `.then((result: any[]) => result[0]?.count || 0),
    ]);

    if (chat && chat.unreadMessages !== unreadMessages) {
      await this.prismaRepository.chat.update({ where: { id: chat.id }, data: { unreadMessages } });
    }

    return unreadMessages;
  }

  private async addLabel(labelId: string, instanceId: string, chatId: string) {
    const id = cuid();

    await this.prismaRepository.$executeRawUnsafe(
      `INSERT INTO "Chat" ("id", "instanceId", "remoteJid", "labels", "createdAt", "updatedAt")
       VALUES ($4, $2, $3, to_jsonb(ARRAY[$1]::text[]), NOW(), NOW()) ON CONFLICT ("instanceId", "remoteJid")
     DO
      UPDATE
          SET "labels" = (
          SELECT to_jsonb(array_agg(DISTINCT elem))
          FROM (
          SELECT jsonb_array_elements_text("Chat"."labels") AS elem
          UNION
          SELECT $1::text AS elem
          ) sub
          ),
          "updatedAt" = NOW();`,
      labelId,
      instanceId,
      chatId,
      id,
    );
  }

  private async removeLabel(labelId: string, instanceId: string, chatId: string) {
    const id = cuid();

    await this.prismaRepository.$executeRawUnsafe(
      `INSERT INTO "Chat" ("id", "instanceId", "remoteJid", "labels", "createdAt", "updatedAt")
       VALUES ($4, $2, $3, '[]'::jsonb, NOW(), NOW()) ON CONFLICT ("instanceId", "remoteJid")
     DO
      UPDATE
          SET "labels" = COALESCE (
          (
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements_text("Chat"."labels") AS elem
          WHERE elem <> $1
          ),
          '[]'::jsonb
          ),
          "updatedAt" = NOW();`,
      labelId,
      instanceId,
      chatId,
      id,
    );
  }

  public async baileysOnWhatsapp(jid: string) {
    const response = await this.client.onWhatsApp(jid);

    return response;
  }

  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview', timeoutMs: number) {
    const response = await this.client.profilePictureUrl(jid, type, timeoutMs);

    return response;
  }

  public async baileysAssertSessions(jids: string[]) {
    const response = await this.client.assertSessions(jids);

    return response;
  }

  public async baileysCreateParticipantNodes(jids: string[], message: proto.IMessage, extraAttrs: any) {
    const response = await this.client.createParticipantNodes(jids, message, extraAttrs);

    const convertedResponse = {
      ...response,
      nodes: response.nodes.map((node: any) => ({
        ...node,
        content: node.content?.map((c: any) => ({
          ...c,
          content: c.content instanceof Uint8Array ? Buffer.from(c.content).toString('base64') : c.content,
        })),
      })),
    };

    return convertedResponse;
  }

  public async baileysSendNode(stanza: any) {
    console.log('stanza', JSON.stringify(stanza));
    const response = await this.client.sendNode(stanza);

    return response;
  }

  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean) {
    const response = await this.client.getUSyncDevices(jids, useCache, ignoreZeroDevices);

    return response;
  }

  public async baileysGenerateMessageTag() {
    const response = await this.client.generateMessageTag();

    return response;
  }

  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: string) {
    try {
      const ciphertextBuffer = Buffer.from(ciphertext, 'base64');

      const response = await this.client.signalRepository.decryptMessage({ jid, type, ciphertext: ciphertextBuffer });

      return response instanceof Uint8Array ? Buffer.from(response).toString('base64') : response;
    } catch (error) {
      this.logger.error('Error decrypting message:');
      this.logger.error(error);
      throw error;
    }
  }

  public async baileysGetAuthState() {
    const response = { me: this.client.authState.creds.me, account: this.client.authState.creds.account };

    return response;
  }

  //Business Controller
  public async fetchCatalog(instanceName: string, data: getCollectionsDto) {
    const jid = data.number ? createJid(data.number) : this.client?.user?.id;
    const limit = data.limit || 10;
    const cursor = null;

    const onWhatsapp = (await this.whatsappNumber({ numbers: [jid] }))?.shift();

    if (!onWhatsapp.exists) {
      throw new BadRequestException(onWhatsapp);
    }

    try {
      const info = (await this.whatsappNumber({ numbers: [jid] }))?.shift();
      const business = await this.fetchBusinessProfile(info?.jid);

      let catalog = await this.getCatalog({ jid: info?.jid, limit, cursor });
      let nextPageCursor = catalog.nextPageCursor;
      let nextPageCursorJson = nextPageCursor ? JSON.parse(atob(nextPageCursor)) : null;
      let pagination = nextPageCursorJson?.pagination_cursor
        ? JSON.parse(atob(nextPageCursorJson.pagination_cursor))
        : null;
      let fetcherHasMore = pagination?.fetcher_has_more === true ? true : false;

      let productsCatalog = catalog.products || [];
      let countLoops = 0;
      while (fetcherHasMore && countLoops < 4) {
        catalog = await this.getCatalog({ jid: info?.jid, limit, cursor: nextPageCursor });
        nextPageCursor = catalog.nextPageCursor;
        nextPageCursorJson = nextPageCursor ? JSON.parse(atob(nextPageCursor)) : null;
        pagination = nextPageCursorJson?.pagination_cursor
          ? JSON.parse(atob(nextPageCursorJson.pagination_cursor))
          : null;
        fetcherHasMore = pagination?.fetcher_has_more === true ? true : false;
        productsCatalog = [...productsCatalog, ...catalog.products];
        countLoops++;
      }

      return {
        wuid: info?.jid || jid,
        numberExists: info?.exists,
        isBusiness: business.isBusiness,
        catalogLength: productsCatalog.length,
        catalog: productsCatalog,
      };
    } catch (error) {
      console.log(error);
      return { wuid: jid, name: null, isBusiness: false };
    }
  }

  public async getCatalog({
    jid,
    limit,
    cursor,
  }: GetCatalogOptions): Promise<{ products: Product[]; nextPageCursor: string | undefined }> {
    try {
      jid = jid ? createJid(jid) : this.instance.wuid;

      const catalog = await this.client.getCatalog({ jid, limit: limit, cursor: cursor });

      if (!catalog) {
        return { products: undefined, nextPageCursor: undefined };
      }

      return catalog;
    } catch (error) {
      throw new InternalServerErrorException('Error getCatalog', error.toString());
    }
  }

  public async fetchCollections(instanceName: string, data: getCollectionsDto) {
    const jid = data.number ? createJid(data.number) : this.client?.user?.id;
    const limit = data.limit <= 20 ? data.limit : 20; //(tem esse limite, não sei porque)

    const onWhatsapp = (await this.whatsappNumber({ numbers: [jid] }))?.shift();

    if (!onWhatsapp.exists) {
      throw new BadRequestException(onWhatsapp);
    }

    try {
      const info = (await this.whatsappNumber({ numbers: [jid] }))?.shift();
      const business = await this.fetchBusinessProfile(info?.jid);
      const collections = await this.getCollections(info?.jid, limit);

      return {
        wuid: info?.jid || jid,
        name: info?.name,
        numberExists: info?.exists,
        isBusiness: business.isBusiness,
        collectionsLength: collections?.length,
        collections: collections,
      };
    } catch {
      return { wuid: jid, name: null, isBusiness: false };
    }
  }

  public async getCollections(jid?: string | undefined, limit?: number): Promise<CatalogCollection[]> {
    try {
      jid = jid ? createJid(jid) : this.instance.wuid;

      const result = await this.client.getCollections(jid, limit);

      if (!result) {
        return [{ id: undefined, name: undefined, products: [], status: undefined }];
      }

      return result.collections;
    } catch (error) {
      throw new InternalServerErrorException('Error getCatalog', error.toString());
    }
  }

  public async fetchMessages(query: Query<Message>) {
    const keyFilters = query?.where?.key as ExtendedIMessageKey;

    const timestampFilter = {};
    if (query?.where?.messageTimestamp) {
      if (query.where.messageTimestamp['gte'] && query.where.messageTimestamp['lte']) {
        timestampFilter['messageTimestamp'] = {
          gte: Math.floor(new Date(query.where.messageTimestamp['gte']).getTime() / 1000),
          lte: Math.floor(new Date(query.where.messageTimestamp['lte']).getTime() / 1000),
        };
      }
    }

    const count = await this.prismaRepository.message.count({
      where: {
        instanceId: this.instanceId,
        id: query?.where?.id,
        source: query?.where?.source,
        messageType: query?.where?.messageType,
        ...timestampFilter,
        AND: [
          keyFilters?.id ? { key: { path: ['id'], equals: keyFilters?.id } } : {},
          keyFilters?.fromMe ? { key: { path: ['fromMe'], equals: keyFilters?.fromMe } } : {},
          keyFilters?.participant ? { key: { path: ['participant'], equals: keyFilters?.participant } } : {},
          {
            OR: [
              keyFilters?.remoteJid ? { key: { path: ['remoteJid'], equals: keyFilters?.remoteJid } } : {},
              keyFilters?.remoteJid ? { key: { path: ['remoteJidAlt'], equals: keyFilters?.remoteJid } } : {},
              keyFilters?.remoteJidAlt ? { key: { path: ['remoteJidAlt'], equals: keyFilters?.remoteJidAlt } } : {},
            ],
          },
        ],
      },
    });

    if (!query?.offset) {
      query.offset = 50;
    }

    if (!query?.page) {
      query.page = 1;
    }

    const messages = await this.prismaRepository.message.findMany({
      where: {
        instanceId: this.instanceId,
        id: query?.where?.id,
        source: query?.where?.source,
        messageType: query?.where?.messageType,
        ...timestampFilter,
        AND: [
          keyFilters?.id ? { key: { path: ['id'], equals: keyFilters?.id } } : {},
          keyFilters?.fromMe ? { key: { path: ['fromMe'], equals: keyFilters?.fromMe } } : {},
          keyFilters?.participant ? { key: { path: ['participant'], equals: keyFilters?.participant } } : {},
          {
            OR: [
              keyFilters?.remoteJid ? { key: { path: ['remoteJid'], equals: keyFilters?.remoteJid } } : {},
              keyFilters?.remoteJid ? { key: { path: ['remoteJidAlt'], equals: keyFilters?.remoteJid } } : {},
              keyFilters?.remoteJidAlt ? { key: { path: ['remoteJidAlt'], equals: keyFilters?.remoteJidAlt } } : {},
            ],
          },
        ],
      },
      orderBy: { messageTimestamp: 'desc' },
      skip: query.offset * (query?.page === 1 ? 0 : (query?.page as number) - 1),
      take: query.offset,
      select: {
        id: true,
        key: true,
        pushName: true,
        managerSenderId: true,
        managerSenderName: true,
        managerSigned: true,
        messageType: true,
        message: true,
        messageTimestamp: true,
        instanceId: true,
        source: true,
        contextInfo: true,
        MessageUpdate: { select: { status: true } },
      },
    });

    const normalizeParticipantJid = (jid: string) => jid.replace(/:\d+(?=@)/, '');
    const participantJids = Array.from(
      new Set(
        messages.flatMap((message) => {
          const key = message.key as { participant?: string; participantAlt?: string };
          return [key.participant, key.participantAlt].filter((jid): jid is string => Boolean(jid));
        }),
      ),
    );
    const participantJidMappings = new Map<string, string>();
    await Promise.all(
      participantJids.map(async (jid) => {
        const normalizedJid = normalizeParticipantJid(jid);
        if (normalizedJid !== jid) participantJidMappings.set(jid, normalizedJid);
        try {
          const mapping = this.client.signalRepository.lidMapping;
          const alias = normalizedJid.endsWith('@lid')
            ? await mapping.getPNForLID(normalizedJid)
            : await mapping.getLIDForPN(normalizedJid);
          if (alias) participantJidMappings.set(jid, normalizeParticipantJid(alias));
        } catch {
          // Keep the LID as a fallback when WhatsApp has no phone mapping for it.
        }
      }),
    );
    const contactJids = [
      ...new Set([...participantJids.map(normalizeParticipantJid), ...participantJidMappings.values()]),
    ];
    const participantContacts = contactJids.length
      ? await this.prismaRepository.contact.findMany({
          where: { instanceId: this.instanceId, remoteJid: { in: contactJids } },
          select: { remoteJid: true, pushName: true, customName: true },
        })
      : [];
    const contactsByJid = new Map(participantContacts.map((contact) => [contact.remoteJid, contact]));
    const senderNamesFromHistory = new Map<string, string>();
    for (const message of messages) {
      const key = message.key as { fromMe?: boolean; participant?: string; participantAlt?: string };
      if (key.fromMe || !this.isUsefulGroupSenderName(message.pushName)) continue;
      for (const jid of [key.participant, key.participantAlt]) {
        if (jid && !senderNamesFromHistory.has(normalizeParticipantJid(jid))) {
          senderNamesFromHistory.set(normalizeParticipantJid(jid), message.pushName.trim());
        }
      }
    }

    // A sender's name may be present on an older page or in another group of this instance.
    const unresolvedJids = participantJids.filter((jid) => {
      const normalized = normalizeParticipantJid(jid);
      const mapped = participantJidMappings.get(jid);
      const contact = contactsByJid.get(normalized) || (mapped && contactsByJid.get(mapped));
      return !senderNamesFromHistory.has(normalized) && !this.isUsefulGroupSenderName(contact?.pushName);
    });
    if (unresolvedJids.length) {
      const lookupJids = [
        ...new Set(
          unresolvedJids
            .flatMap((jid) => [jid, normalizeParticipantJid(jid), participantJidMappings.get(jid)])
            .filter((jid): jid is string => Boolean(jid)),
        ),
      ];
      const historyMessages = await this.prismaRepository.message.findMany({
        where: {
          instanceId: this.instanceId,
          pushName: { not: null },
          OR: lookupJids.flatMap((jid) => [
            { key: { path: ['participant'], equals: jid } },
            { key: { path: ['participantAlt'], equals: jid } },
          ]),
        },
        select: { key: true, pushName: true },
        orderBy: { messageTimestamp: 'desc' },
        take: 2000,
      });
      for (const message of historyMessages) {
        const key = message.key as { fromMe?: boolean; participant?: string; participantAlt?: string };
        if (key.fromMe || !this.isUsefulGroupSenderName(message.pushName)) continue;
        for (const jid of [key.participant, key.participantAlt]) {
          if (jid && !senderNamesFromHistory.has(normalizeParticipantJid(jid))) {
            senderNamesFromHistory.set(normalizeParticipantJid(jid), message.pushName.trim());
          }
        }
      }
    }

    const formattedMessages = messages.map((message) => {
      const messageKey = message.key as {
        fromMe: boolean;
        remoteJid: string;
        id: string;
        participant?: string;
        participantAlt?: string;
      };

      if (messageKey.fromMe) {
        if (!message.pushName) message.pushName = 'Você';
      } else {
        const participantCandidates = [messageKey.participant, messageKey.participantAlt].filter((jid): jid is string =>
          Boolean(jid),
        );
        const resolvedCandidates = participantCandidates.flatMap((jid) => [
          participantJidMappings.get(jid) || normalizeParticipantJid(jid),
        ]);
        const matchingContacts = [...participantCandidates.map(normalizeParticipantJid), ...resolvedCandidates]
          .map((jid) => contactsByJid.get(jid))
          .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
        const meaningfulName = (name?: string | null) => (this.isUsefulGroupSenderName(name) ? name.trim() : undefined);
        const historyName = [...participantCandidates, ...resolvedCandidates]
          .map((jid) => senderNamesFromHistory.get(normalizeParticipantJid(jid)))
          .find(Boolean);
        const customName = matchingContacts.map((contact) => meaningfulName(contact.customName)).find(Boolean);
        const contactName = matchingContacts.map((contact) => meaningfulName(contact.pushName)).find(Boolean);
        const messageName = meaningfulName(message.pushName);
        const participantJid = participantCandidates[0];
        const resolvedParticipantJid = participantJid ? participantJidMappings.get(participantJid) : undefined;
        const participantDisplay = participantJid ? normalizeParticipantJid(participantJid).split('@')[0] : undefined;

        const senderName = customName || messageName || contactName || historyName;
        if (senderName) {
          message.pushName = senderName;
        } else if (resolvedParticipantJid?.endsWith('@s.whatsapp.net')) {
          message.pushName = resolvedParticipantJid.split('@')[0];
        } else if (!message.pushName && participantJid) {
          message.pushName = participantDisplay;
        } else if (participantJid && message.pushName === participantJid.split('@')[0]) {
          message.pushName = participantDisplay;
        }

        if (!message.pushName && message.contextInfo) {
          const contextInfo = message.contextInfo as { participant?: string };
          if (contextInfo.participant) {
            message.pushName = contextInfo.participant.split('@')[0];
          }
        }
      }

      return message;
    });

    return {
      messages: {
        total: count,
        pages: Math.ceil(count / query.offset),
        currentPage: query.page,
        records: formattedMessages,
      },
    };
  }
}
