import type { PrismaRepository } from '@api/repository/repository.service';
import { Auth, configService } from '@config/env.config';
import { createPixCharge, PixCharge, PixRequestError } from '@utils/pix';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';
import { Router } from 'express';

type ChargeToken = PixCharge & { instanceName: string };

const sign = (payload: string, instanceToken: string) =>
  createHmac('sha256', `${configService.get<Auth>('AUTHENTICATION').API_KEY.KEY}:${instanceToken}`)
    .update(payload)
    .digest('base64url');

export class PixRouter {
  public readonly router = Router();

  constructor(
    private readonly repository: PrismaRepository,
    auth: RequestHandler,
  ) {
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
      res.json(payment.charge);
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
