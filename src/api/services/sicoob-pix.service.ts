import { prismaRepository, sendMessageController } from '@api/server.module';
import { Logger } from '@config/logger.config';
import { PixPaymentLink, SicoobPixConfig } from '@prisma/client';
import axios from 'axios';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Agent } from 'https';
import PDFDocument from 'pdfkit';
import { createSecureContext, rootCertificates } from 'tls';

const logger = new Logger('SicoobPix');
const scopes =
  'pix.read pix.write cob.read cob.write webhook.read webhook.write webhooks_consulta webhooks_inclusao webhooks_alteracao';
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearSicoobToken(instanceId: string): void {
  tokenCache.delete(instanceId);
}

export class SicoobError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.SICOOB_CREDENTIALS_KEY || '', 'base64');
  if (key.length !== 32) throw new SicoobError('Configure SICOOB_CREDENTIALS_KEY com 32 bytes em base64', 503);
  return key;
}

export function encryptSecret(value: string | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptSecret(value: string): Buffer {
  const data = Buffer.from(value, 'base64');
  if (data.length < 29) throw new SicoobError('Credencial Sicoob inválida', 503);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}

export const decryptSicoobSecret = (value: string): string => decryptSecret(value).toString('utf8');

export function validateSicoobUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SicoobError('Informe uma URL válida do Sicoob');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(host === 'sicoob.com.br' || host.endsWith('.sicoob.com.br') || host === 'apis.sisbr.com.br')
  ) {
    throw new SicoobError('A URL deve usar HTTPS e pertencer ao Sicoob');
  }
  return url.toString().replace(/\/$/, '');
}

export function validateCertificates(cert: string, key: string, ca?: string): void {
  if (
    !cert.includes('-----BEGIN CERTIFICATE-----') ||
    !key.includes('-----BEGIN ') ||
    (ca && !ca.includes('-----BEGIN CERTIFICATE-----'))
  )
    throw new SicoobError('Envie certificado, chave privada e CA em formato PEM');
  try {
    createSecureContext({ cert, key, ...(ca && { ca: [...rootCertificates, ca] }) });
  } catch {
    throw new SicoobError('Certificado PEM e chave privada inválidos');
  }
}

function bankAgent(config: SicoobPixConfig): Agent {
  return new Agent({
    cert: decryptSecret(config.certPem).toString('utf8'),
    key: decryptSecret(config.keyPem).toString('utf8'),
    ...(config.caPem && { ca: [...rootCertificates, decryptSecret(config.caPem).toString('utf8')] }),
    rejectUnauthorized: true,
    keepAlive: true,
  });
}

async function accessToken(config: SicoobPixConfig): Promise<string> {
  const cached = tokenCache.get(config.instanceId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    scope: scopes,
  });
  if (config.clientSecret) form.set('client_secret', decryptSecret(config.clientSecret).toString('utf8'));
  const response = await axios.post<{ access_token: string; expires_in: number }>(config.tokenUrl, form.toString(), {
    httpsAgent: bankAgent(config),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
    maxRedirects: 0,
  });
  if (!response.data?.access_token) throw new SicoobError('Sicoob não retornou token de acesso', 502);
  tokenCache.set(config.instanceId, {
    token: response.data.access_token,
    expiresAt: Date.now() + Math.max(0, Number(response.data.expires_in || 300) - 30) * 1000,
  });
  return response.data.access_token;
}

export async function testSicoobConfiguration(config: SicoobPixConfig): Promise<void> {
  clearSicoobToken(config.instanceId);
  await accessToken(config);
}

async function bankRequest<T>(
  config: SicoobPixConfig,
  method: 'GET' | 'PUT',
  path: string,
  data?: unknown,
): Promise<T> {
  const token = await accessToken(config);
  const response = await axios.request<T>({
    method,
    url: `${config.apiUrl.replace(/\/pix\/api\/v2\/?$/i, '')}/pix/api/v2/${path}`,
    data,
    httpsAgent: bankAgent(config),
    headers: { Authorization: `Bearer ${token}`, client_id: config.clientId },
    timeout: 15_000,
    maxRedirects: 0,
  });
  return response.data;
}

export async function registerSicoobWebhook(config: SicoobPixConfig, baseUrl: string): Promise<void> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:') throw new SicoobError('Configure SERVER_URL com HTTPS para registrar o webhook');
  const webhookUrl = new URL(`/pix/sicoob-webhook/${config.instanceId}/${config.webhookSecret}`, url).toString();
  await bankRequest(config, 'PUT', `webhook/${encodeURIComponent(config.pixKey)}`, { webhookUrl });
}

type BankPix = { endToEndId?: string; e2eid?: string; valor?: string; horario?: string; txid?: string };
type BankCharge = {
  txid?: string;
  status?: string;
  pixCopiaECola?: string;
  valor?: { original?: string };
  pix?: BankPix[];
};

export async function createSicoobCharge(
  instance: { id: string; name: string },
  remoteJid: string,
  amount: string,
  description: string,
  baseUrl: string,
) {
  const config = await prismaRepository.sicoobPixConfig.findUnique({ where: { instanceId: instance.id } });
  if (!config) throw new SicoobError('Configure a integração Sicoob antes de criar cobranças');
  if (!/^\d{1,8}\.\d{2}$/.test(amount) || Number(amount) <= 0) throw new SicoobError('Informe um valor válido');
  if (!/^\d{8,20}@s\.whatsapp\.net$/.test(remoteJid)) throw new SicoobError('Selecione uma conversa individual válida');
  if (description.length > 140) throw new SicoobError('A descrição deve ter até 140 caracteres');
  const host = new URL(baseUrl);
  if (host.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(host.hostname)) {
    throw new SicoobError('Configure SERVER_URL com HTTPS para enviar cobranças');
  }
  const txid = randomBytes(16).toString('hex');
  let bank: BankCharge;
  try {
    bank = await bankRequest<BankCharge>(config, 'PUT', `cob/${txid}`, {
      calendario: { expiracao: config.expiresIn },
      valor: { original: amount },
      chave: config.pixKey,
      ...(description && {
        solicitacaoPagador: description,
        infoAdicionais: [{ nome: 'Descrição', valor: description }],
      }),
    });
  } catch (error) {
    logger.error(
      `Sicoob charge creation failed: ${axios.isAxiosError(error) ? error.response?.status : String(error)}`,
    );
    throw new SicoobError('Não foi possível registrar a cobrança no Sicoob', 502);
  }
  const code =
    bank.pixCopiaECola ||
    (bank as BankCharge & { brcode?: string; emv?: string }).brcode ||
    (bank as BankCharge & { emv?: string }).emv;
  if ((bank.txid && bank.txid !== txid) || (bank.valor?.original && bank.valor.original !== amount) || !code) {
    throw new SicoobError('O Sicoob retornou uma cobrança incompleta', 502);
  }
  const id = randomBytes(16).toString('base64url');
  const paymentUrl = new URL(`/manager/payment/${instance.id}/${id}`, host).toString();
  const charge = {
    key: config.pixKey,
    code,
    amount,
    merchantName: config.merchantName,
    merchantCity: config.merchantCity,
    description,
    txid,
    expiresAt: new Date(Date.now() + config.expiresIn * 1000).toISOString(),
  };
  await prismaRepository.pixPaymentLink.create({
    data: { id, instanceId: instance.id, provider: 'sicoob', txid, remoteJid, charge },
  });
  const number = remoteJid.split('@')[0];
  await sendMessageController.sendButtons(
    { instanceName: instance.name },
    {
      number,
      title: 'Cobrança Pix Sicoob',
      description: [`Valor: R$ ${amount.replace('.', ',')}`, description].filter(Boolean).join('\n'),
      buttons: [{ type: 'url', displayText: 'Abrir e Pagar', url: paymentUrl }],
    },
  );
  return { id, txid, paymentUrl, amount };
}

function receiptPdf(payment: PixPaymentLink, pix: BankPix): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const charge = payment.charge as { amount: string; merchantName: string; description?: string };
    doc.fontSize(18).text('Comprovante de recebimento Pix');
    doc.moveDown().fontSize(10).text('Dados de pagamento confirmados pela API Pix do Sicoob.');
    doc
      .moveDown()
      .fontSize(12)
      .text(`Valor: R$ ${charge.amount.replace('.', ',')}`);
    doc.text(`Recebedor: ${charge.merchantName}`);
    if (charge.description) doc.text(`Descrição: ${charge.description}`);
    doc.text(`Data: ${new Date(pix.horario || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    doc
      .moveDown()
      .fontSize(10)
      .text(`Identificador Pix: ${pix.endToEndId || pix.e2eid}`);
    doc.text(`Identificador da cobrança: ${payment.txid}`);
    doc
      .moveDown()
      .fontSize(9)
      .text('Este documento foi gerado pelo CloudBR Chat a partir dos dados confirmados pelo Sicoob.');
    doc.end();
  });
}

export async function reconcileSicoobPayment(payment: PixPaymentLink): Promise<void> {
  if (payment.provider !== 'sicoob' || !payment.txid || !payment.remoteJid || payment.notifiedAt) return;
  const config = await prismaRepository.sicoobPixConfig.findUnique({ where: { instanceId: payment.instanceId } });
  if (!config) return;
  const bank = await bankRequest<BankCharge>(config, 'GET', `cob/${payment.txid}`);
  const charge = payment.charge as { amount: string };
  const pix = bank.pix?.find(
    (item) =>
      (!item.txid || item.txid === payment.txid) &&
      (!item.valor || Number(item.valor) === Number(charge.amount)) &&
      (item.endToEndId || item.e2eid),
  );
  if (
    bank.status !== 'CONCLUIDA' ||
    (bank.txid && bank.txid !== payment.txid) ||
    (bank.valor?.original && Number(bank.valor.original) !== Number(charge.amount)) ||
    !pix
  )
    return;
  const claimed = await prismaRepository.pixPaymentLink.updateMany({
    where: {
      id: payment.id,
      instanceId: payment.instanceId,
      notifiedAt: null,
      OR: [{ claimAt: null }, { claimAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
    },
    data: {
      claimAt: new Date(),
      status: 'paid',
      paidAt: new Date(pix.horario || Date.now()),
      endToEndId: pix.endToEndId || pix.e2eid,
    },
  });
  if (!claimed.count) return;
  try {
    const instance = await prismaRepository.instance.findUnique({
      where: { id: payment.instanceId },
      select: { name: true },
    });
    if (!instance) return;
    const pdf = await receiptPdf(payment, pix);
    await sendMessageController.sendMedia(
      { instanceName: instance.name },
      {
        number: payment.remoteJid.split('@')[0],
        mediatype: 'document',
        mimetype: 'application/pdf',
        fileName: `comprovante-pix-${payment.txid}.pdf`,
        caption: `Pagamento confirmado pelo Sicoob. Valor: R$ ${charge.amount.replace('.', ',')}. Pix: ${pix.endToEndId || pix.e2eid}`,
        media: pdf.toString('base64'),
      },
    );
    await prismaRepository.pixPaymentLink.update({ where: { id: payment.id }, data: { notifiedAt: new Date() } });
  } catch (error) {
    await prismaRepository.pixPaymentLink.update({ where: { id: payment.id }, data: { claimAt: null } });
    throw error;
  }
}

let running = false;
export function startSicoobReconciliation(): void {
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const payments = await prismaRepository.pixPaymentLink.findMany({
        where: { provider: 'sicoob', notifiedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const payment of payments) {
        try {
          await reconcileSicoobPayment(payment);
        } catch (error) {
          logger.error(`Sicoob reconciliation failed for ${payment.id}: ${String(error)}`);
        }
      }
    } catch (error) {
      logger.error(`Sicoob reconciliation failed: ${String(error)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(poll, 30_000);
  timer.unref();
}
