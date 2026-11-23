import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { proto } from 'baileys';

// Run after npm run build so this exercises the production CommonJS bundle.
const require = createRequire(import.meta.url);
const { BaileysStartupService } = require('../dist/api/integrations/channel/whatsapp/whatsapp.baileys.service.js');

const makeService = () => {
  const service = Object.create(BaileysStartupService.prototype);
  service.mapType = new Map([
    ['reply', 'quick_reply'],
    ['copy', 'cta_copy'],
    ['url', 'cta_url'],
    ['call', 'cta_call'],
    ['pix', 'payment_info'],
  ]);
  service.mapKeyType = new Map([['random', 'EVP']]);
  service.instance = { wuid: '5511999999999@s.whatsapp.net' };
  service.sendMessageWithTyping = async (_number, message) => message;
  return service;
};

test('reply buttons and lists produce serializable native flows', async () => {
  const service = makeService();
  const buttons = await service.buttonMessage({
    number: '5511888888888',
    title: 'Escolha',
    buttons: [{ type: 'reply', displayText: 'Sim', id: 'yes' }],
  });
  const list = await service.listMessage({
    number: '5511888888888',
    title: 'Menu',
    buttonText: 'Abrir menu',
    sections: [{ title: 'Opções', rows: [{ rowId: 'one', title: 'Primeira', description: 'Item 1' }] }],
  });

  for (const message of [buttons, list]) {
    const decoded = proto.Message.decode(proto.Message.encode(message).finish());
    assert.equal(decoded.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.messageVersion, 1);
  }
  const listButton = list.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0];
  assert.equal(listButton.name, 'single_select');
  assert.equal(JSON.parse(listButton.buttonParamsJson).sections[0].rows[0].id, 'one');
});

test('PIX includes payment flow and private chat relay metadata', async () => {
  const service = makeService();
  const pix = await service.buttonMessage({
    number: '5511888888888',
    title: 'Pague com Pix',
    buttons: [
      { type: 'pix', name: 'Loja', keyType: 'random', key: '00000000-0000-0000-0000-000000000000', amount: 12.34 },
    ],
  });
  const button = pix.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0];
  assert.equal(button.name, 'payment_info');
  assert.equal(JSON.parse(button.buttonParamsJson).currency, 'BRL');
  assert.equal(JSON.parse(button.buttonParamsJson).total_amount.value, 1234);

  let relayOptions;
  let relayedMessage;
  service.client = {
    relayMessage: async (_jid, message, options) => {
      relayedMessage = message;
      relayOptions = options;
      return options.messageId;
    },
  };
  const sent = await service.sendMessage('5511888888888@s.whatsapp.net', pix, undefined, undefined, undefined);
  assert.equal(relayOptions.messageId, sent.key.id);
  assert.deepEqual(relayOptions.additionalNodes.map((node) => node.tag), ['bot', 'biz']);
  assert.equal(relayOptions.additionalNodes[1].attrs.native_flow_name, 'payment_info');
  assert.equal(relayedMessage.viewOnceMessage.message.interactiveMessage.body.text, 'Pague com Pix');
});

test('list relay includes mixed native flow metadata for groups', async () => {
  const service = makeService();
  const list = await service.listMessage({
    number: '123@g.us',
    title: 'Menu',
    buttonText: 'Abrir',
    sections: [{ title: 'Opções', rows: [{ rowId: 'one', title: 'Primeira' }] }],
  });
  let relayOptions;
  service.client = {
    relayMessage: async (_jid, _message, options) => {
      relayOptions = options;
      return options.messageId;
    },
  };
  await service.sendMessage('123@g.us', list, undefined, undefined, undefined);
  assert.deepEqual(relayOptions.additionalNodes.map((node) => node.tag), ['biz']);
  assert.equal(relayOptions.additionalNodes[0].content[0].content[0].attrs.name, 'mixed');
});

test('rejects incomplete PIX details before relaying', async () => {
  const service = makeService();
  await assert.rejects(
    service.buttonMessage({ number: '5511888888888', title: 'Pix', buttons: [{ type: 'pix', name: 'Loja' }] }),
    (error) => error.status === 400 && error.message.includes('Dados incompletos para o botão pix'),
  );
});
