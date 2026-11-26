import type { PrismaRepository } from '@api/repository/repository.service';
import { getManagerPrincipal } from '@api/services/manager-saas.service';
import {
  clearSicoobToken,
  createSicoobCharge,
  decryptSicoobSecret,
  encryptSecret,
  reconcileSicoobPayment,
  registerSicoobWebhook,
  SicoobError,
  testSicoobConfiguration,
  validateCertificates,
  validateSicoobUrl,
} from '@api/services/sicoob-pix.service';
import { Auth, configService } from '@config/env.config';
import { createPixCharge, PixCharge, PixRequestError } from '@utils/pix';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';

type ChargeToken = PixCharge & { instanceName: string };

const sign = (payload: string, instanceToken: string) =>
  createHmac('sha256', `${configService.get<Auth>('AUTHENTICATION').API_KEY.KEY}:${instanceToken}`)
    .update(payload)
    .digest('base64url');

const certificateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024, files: 3 } });
const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);

export class PixRouter {
  public readonly router = Router();

  constructor(
    private readonly repository: PrismaRepository,
    auth: RequestHandler,
  ) {
    this.router.get(
      '/sicoob-settings/:instanceName',
      auth,
      asyncRoute(async (req, res) => {
        const principal = getManagerPrincipal(req);
        if (!principal || principal.role === 'user') throw new SicoobError('Acesso restrito ao administrador', 403);
        const instance = await this.repository.instance.findFirst({
          where: { name: req.params.instanceName, companyId: principal.companyId },
        });
        if (!instance) throw new SicoobError('Instância não encontrada', 404);
        const settings = await this.repository.sicoobPixConfig.findUnique({ where: { instanceId: instance.id } });
        res.json(
          settings
            ? {
                clientId: settings.clientId,
                pixKey: settings.pixKey,
                merchantName: settings.merchantName,
                merchantCity: settings.merchantCity,
                tokenUrl: settings.tokenUrl,
                apiUrl: settings.apiUrl,
                sandboxMode: settings.sandboxMode,
                expiresIn: settings.expiresIn,
                hasCert: true,
                hasKey: true,
                hasCa: Boolean(settings.caPem),
                hasClientSecret: Boolean(settings.clientSecret),
              }
            : null,
        );
      }),
    );

    this.router.post(
      '/sicoob-settings/:instanceName',
      auth,
      certificateUpload.fields([
        { name: 'cert', maxCount: 1 },
        { name: 'key', maxCount: 1 },
        { name: 'ca', maxCount: 1 },
      ]),
      asyncRoute(async (req, res) => {
        const principal = getManagerPrincipal(req);
        if (!principal || principal.role === 'user') throw new SicoobError('Acesso restrito ao administrador', 403);
        const instance = await this.repository.instance.findFirst({
          where: { name: req.params.instanceName, companyId: principal.companyId },
        });
        if (!instance) throw new SicoobError('Instância não encontrada', 404);
        const previous = await this.repository.sicoobPixConfig.findUnique({ where: { instanceId: instance.id } });
        const value = (key: string, max: number) => {
          const field = req.body[key];
          if (typeof field !== 'string' || !field.trim() || field.length > max)
            throw new SicoobError(`Campo ${key} inválido`);
          return field.trim();
        };
        const clientId = value('clientId', 255);
        const pixKey = value('pixKey', 77);
        const merchantName = value('merchantName', 100);
        const merchantCity = value('merchantCity', 100);
        const tokenUrl = validateSicoobUrl(value('tokenUrl', 500));
        const apiUrl = validateSicoobUrl(value('apiUrl', 500));
        const sandboxMode = req.body.sandboxMode === 'true';
        const expiresIn = Number(req.body.expiresIn);
        if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 86400)
          throw new SicoobError('Prazo da cobrança inválido');
        const clientSecret = req.body.clientSecret
          ? encryptSecret(value('clientSecret', 500))
          : previous?.clientSecret || '';
        const files = (req as Request & { files?: Record<string, Array<{ buffer: Buffer }>> }).files;
        const pem = (key: 'cert' | 'key' | 'ca') => files?.[key]?.[0]?.buffer.toString('utf8').trim();
        const cert = pem('cert');
        const key = pem('key');
        const ca = pem('ca');
        const certPem = cert ? encryptSecret(cert) : previous?.certPem;
        const keyPem = key ? encryptSecret(key) : previous?.keyPem;
        const caPem = ca ? encryptSecret(ca) : previous?.caPem;
        if (!certPem || !keyPem) throw new SicoobError('Envie certificado PEM e chave privada PEM');
        if (cert || key || ca) {
          validateCertificates(
            cert || decryptSicoobSecret(certPem),
            key || decryptSicoobSecret(keyPem),
            ca || (caPem ? decryptSicoobSecret(caPem) : undefined),
          );
        }
        const saved = await this.repository.sicoobPixConfig.upsert({
          where: { instanceId: instance.id },
          create: {
            instanceId: instance.id,
            clientId,
            clientSecret,
            pixKey,
            merchantName,
            merchantCity,
            tokenUrl,
            apiUrl,
            sandboxMode,
            expiresIn,
            certPem,
            keyPem,
            caPem,
            webhookSecret: randomBytes(32).toString('hex'),
          },
          update: {
            clientId,
            clientSecret,
            pixKey,
            merchantName,
            merchantCity,
            tokenUrl,
            apiUrl,
            sandboxMode,
            expiresIn,
            certPem,
            keyPem,
            caPem,
          },
        });
        clearSicoobToken(instance.id);
        const baseUrl = configService.get('SERVER').URL || `${req.protocol}://${req.get('host')}`;
        let webhookRegistered = false;
        try {
          await registerSicoobWebhook(saved, baseUrl);
          webhookRegistered = true;
        } catch {
          // Reconciliation polling remains active when webhook registration is unavailable.
        }
        res.json({ saved: true, webhookRegistered });
      }),
    );

    this.router.post(
      '/sicoob-settings/:instanceName/test',
      auth,
      asyncRoute(async (req, res) => {
        const principal = getManagerPrincipal(req);
        if (!principal || principal.role === 'user') throw new SicoobError('Acesso restrito ao administrador', 403);
        const instance = await this.repository.instance.findFirst({
          where: { name: req.params.instanceName, companyId: principal.companyId },
        });
        if (!instance) throw new SicoobError('Instância não encontrada', 404);
        const config = await this.repository.sicoobPixConfig.findUnique({ where: { instanceId: instance.id } });
        if (!config) throw new SicoobError('Configure o Sicoob primeiro');
        try {
          await testSicoobConfiguration(config);
        } catch {
          throw new SicoobError('Falha na autenticação Sicoob. Verifique credenciais, certificados e URLs.', 502);
        }
        res.json({ connected: true });
      }),
    );

    this.router.post(
      '/sicoob-webhook/:instanceId/:secret',
      asyncRoute(async (req, res) => {
        const config = await this.repository.sicoobPixConfig.findUnique({
          where: { instanceId: req.params.instanceId },
        });
        if (!config || config.webhookSecret !== req.params.secret) throw new SicoobError('Webhook inválido', 404);
        const pix = Array.isArray(req.body?.pix) ? req.body.pix.slice(0, 20) : [];
        const txids = pix
          .map((item: { txid?: unknown }) => item.txid)
          .filter((value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{26,35}$/.test(value));
        const payments = await this.repository.pixPaymentLink.findMany({
          where: { instanceId: config.instanceId, provider: 'sicoob', txid: { in: txids }, notifiedAt: null },
        });
        await Promise.allSettled(payments.map(reconcileSicoobPayment));
        res.sendStatus(204);
      }),
    );

    this.router.post(
      '/create-sicoob/:instanceName',
      auth,
      asyncRoute(async (req, res) => {
        const instance = await this.repository.instance.findUnique({ where: { name: req.params.instanceName } });
        if (!instance || instance.integration !== 'WHATSAPP-BAILEYS')
          throw new SicoobError('A cobrança Sicoob requer uma instância WhatsApp Baileys');
        const remoteJid = req.body?.remoteJid;
        const amount = req.body?.amount;
        const description = req.body?.description || '';
        if (typeof remoteJid !== 'string' || typeof amount !== 'string' || typeof description !== 'string')
          throw new SicoobError('Dados da cobrança inválidos');
        const baseUrl = configService.get('SERVER').URL || `${req.protocol}://${req.get('host')}`;
        const result = await createSicoobCharge(instance, remoteJid, amount, description, baseUrl);
        res.status(201).json(result);
      }),
    );

    this.router.post('/create/:instanceName', auth, async (req, res) => {
      const instance = await this.repository.instance.findUnique({ where: { name: req.params.instanceName } });
      if (!instance?.token || instance.integration !== 'WHATSAPP-BAILEYS') {
        throw new PixRequestError('A cobrança Pix está disponível para instâncias WhatsApp Baileys');
      }
      const charge = createPixCharge(req.body);
      const baseUrl = configService.get('SERVER').URL || `${req.protocol}://${req.get('host')}`;
      const id = randomBytes(16).toString('base64url');
      const paymentUrl = new URL(`/manager/payment/${instance.id}/${id}`, baseUrl).toString();
      const paymentHost = new URL(paymentUrl);
      if (paymentHost.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(paymentHost.hostname)) {
        throw new PixRequestError('Configure SERVER_URL com HTTPS para enviar cobranças Pix');
      }
      await this.repository.pixPaymentLink.create({
        data: { id, instanceId: instance.id, charge },
      });
      res.status(201).json({ ...charge, paymentUrl });
    });

    this.router.get('/:instanceId/:id', async (req, res) => {
      if (!/^[A-Za-z0-9_-]{22}$/.test(req.params.id)) throw new PixRequestError('Link de pagamento inválido');
      const instance = await this.repository.instance.findUnique({ where: { id: req.params.instanceId } });
      if (!instance) throw new PixRequestError('Link de pagamento inválido');
      const payment = await this.repository.pixPaymentLink.findFirst({
        where: { id: req.params.id, instanceId: instance.id },
      });
      if (!payment) throw new PixRequestError('Link de pagamento inválido');
      res.set('Cache-Control', 'no-store');
      res.json({
        ...(payment.charge as object),
        provider: payment.provider,
        status: payment.status,
        paidAt: payment.paidAt,
        endToEndId: payment.endToEndId,
        receiptSent: Boolean(payment.notifiedAt),
      });
    });

    this.router.get('/:token', async (req, res) => {
      const [payload, signature] = req.params.token.split('.');
      if (!payload || !signature || payload.length > 2000 || signature.length > 100) {
        throw new PixRequestError('Link de pagamento inválido');
      }
      let charge: ChargeToken;
      try {
        charge = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        throw new PixRequestError('Link de pagamento inválido');
      }
      if (
        typeof charge?.instanceName !== 'string' ||
        !charge.instanceName ||
        charge.instanceName.length > 100 ||
        typeof charge.code !== 'string'
      ) {
        throw new PixRequestError('Link de pagamento inválido');
      }
      const instance = await this.repository.instance.findUnique({ where: { name: charge.instanceName } });
      if (!instance?.token) throw new PixRequestError('Link de pagamento inválido');
      const expected = Buffer.from(sign(payload, instance.token));
      const received = Buffer.from(signature);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new PixRequestError('Assinatura da cobrança inválida');
      }
      res.set('Cache-Control', 'no-store');
      res.json({
        key: charge.key,
        code: charge.code,
        amount: charge.amount,
        merchantName: charge.merchantName,
        merchantCity: charge.merchantCity,
        description: charge.description,
        txid: charge.txid,
      });
    });
  }
}
