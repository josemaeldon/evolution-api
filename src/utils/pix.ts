import { randomBytes } from 'crypto';

export class PixRequestError extends Error {
  status = 400;
  error = 'Bad Request';
}

export type PixCharge = {
  key: string;
  code: string;
  amount: string;
  merchantName: string;
  merchantCity: string;
  description?: string;
  txid: string;
};

const field = (id: string, value: string) => {
  const length = Buffer.byteLength(value, 'utf8');
  if (length > 99) throw new PixRequestError('Campo Pix excede o tamanho permitido');
  return `${id}${String(length).padStart(2, '0')}${value}`;
};

const normalizeMerchant = (value: string, maximum: number) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 .-]/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maximum);

const crc16 = (value: string) => {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

export function createPixCharge(input: {
  key: string;
  amount: string;
  merchantName: string;
  merchantCity: string;
  description?: string;
}): PixCharge {
  const key = typeof input?.key === 'string' ? input.key.trim() : '';
  const amount = typeof input?.amount === 'string' ? input.amount.trim().replace(',', '.') : '';
  const name = normalizeMerchant(typeof input?.merchantName === 'string' ? input.merchantName : '', 25);
  const city = normalizeMerchant(typeof input?.merchantCity === 'string' ? input.merchantCity : '', 15);
  if (!key || !/^[\x21-\x7E]{1,77}$/.test(key)) throw new PixRequestError('Informe uma chave Pix válida');
  if (!amount || !/^\d{1,6}\.\d{2}$/.test(amount) || Number(amount) <= 0) {
    throw new PixRequestError('Informe um valor Pix positivo com duas casas decimais');
  }
  if (!name || !city) throw new PixRequestError('Informe nome e cidade do recebedor');

  const txid = randomBytes(10).toString('hex').toUpperCase();
  const account = field('00', 'br.gov.bcb.pix') + field('01', key);
  const payload = [
    field('00', '01'),
    field('26', account),
    field('52', '0000'),
    field('53', '986'),
    field('54', amount),
    field('58', 'BR'),
    field('59', name),
    field('60', city),
    field('62', field('05', txid)),
    '6304',
  ].join('');

  const description = typeof input?.description === 'string' ? input.description.trim().slice(0, 120) : undefined;
  return {
    key,
    code: payload + crc16(payload),
    amount,
    merchantName: name,
    merchantCity: city,
    description: description || undefined,
    txid,
  };
}
