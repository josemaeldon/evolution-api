import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { proto } from 'baileys';

const require = createRequire(import.meta.url);
const { BaileysStartupService } = require('../dist/api/integrations/channel/whatsapp/whatsapp.baileys.service.js');
const { createPixCharge } = require('../dist/utils/pix.js');

test('PIX copy code and payment URL remain intact in the same message', async () => {
  const service = Object.create(BaileysStartupService.prototype);
  service.mapType = new Map([['copy', 'cta_copy'], ['url', 'cta_url']]);
  service.sendMessageWithTyping = async (_number, message) => message;

  const code = createPixCharge({
    key: '123e4567-e12b-12d1-a456-426655440000',
    amount: '25.00',
    merchantName: 'Loja',
    merchantCity: 'Belem',
  }).code;
  const url = 'https://pagamentos.example.com/cobranca/123';
  const message = await service.buttonMessage({
    number: '5511888888888',
    title: 'Pague com Pix',
    buttons: [
      { type: 'copy', displayText: 'Copiar código Pix', copyCode: code },
      { type: 'url', displayText: 'Ver pagamento', url },
    ],
  });
  const decoded = proto.Message.decode(proto.Message.encode(message).finish());
  const buttons = decoded.interactiveMessage.nativeFlowMessage.buttons;
  assert.deepEqual(buttons.map((button) => button.name), ['cta_copy', 'cta_url']);
  assert.equal(JSON.parse(buttons[0].buttonParamsJson).copy_code, code);
  assert.equal(JSON.parse(buttons[1].buttonParamsJson).url, url);
});
