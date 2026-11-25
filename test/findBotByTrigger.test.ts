import assert from 'node:assert/strict';
import test from 'node:test';

import { findBotByTrigger } from '../src/utils/findBotByTrigger';

type Bot = {
  id: string;
  instanceId: string;
  enabled: boolean;
  triggerType: string;
  triggerOperator?: string;
  triggerValue?: string;
};

const repository = (bots: Bot[]) => {
  const matches = (bot: Bot, where: Record<string, unknown>) =>
    Object.entries(where).every(([field, value]) => bot[field as keyof Bot] === value);

  return {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => bots.find((bot) => matches(bot, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => bots.filter((bot) => matches(bot, where)),
  };
};

test('a keyword bot starts only when the entire message equals its trigger', async () => {
  const bot: Bot = {
    id: 'keyword',
    instanceId: 'instance-1',
    enabled: true,
    triggerType: 'keyword',
    triggerOperator: 'equals',
    triggerValue: ' INICIAR ',
  };
  const bots = repository([bot]);

  assert.equal(await findBotByTrigger(bots, 'iniciar', 'instance-1'), bot);
  assert.equal(await findBotByTrigger(bots, '  Iniciar  ', 'instance-1'), bot);
  assert.equal(await findBotByTrigger(bots, 'quero iniciar', 'instance-1'), null);
  assert.equal(await findBotByTrigger(bots, 'outra mensagem', 'instance-1'), null);
  assert.equal(await findBotByTrigger(bots, 'iniciar', 'instance-2'), null);
});

test('a bot with no trigger does not start on an unrelated message', async () => {
  const bot: Bot = { id: 'manual', instanceId: 'instance-1', enabled: true, triggerType: 'none' };
  assert.equal(await findBotByTrigger(repository([bot]), 'qualquer mensagem', 'instance-1'), null);
});

test('an all trigger still starts on any message', async () => {
  const bot: Bot = { id: 'all', instanceId: 'instance-1', enabled: true, triggerType: 'all' };
  assert.equal(await findBotByTrigger(repository([bot]), 'qualquer mensagem', 'instance-1'), bot);
});

test('an exact keyword trigger takes precedence over an all trigger', async () => {
  const exactBot: Bot = {
    id: 'exact',
    instanceId: 'instance-1',
    enabled: true,
    triggerType: 'keyword',
    triggerOperator: 'equals',
    triggerValue: 'iniciar',
  };
  const allBot: Bot = { id: 'all', instanceId: 'instance-1', enabled: true, triggerType: 'all' };
  const bots = repository([allBot, exactBot]);

  assert.equal(await findBotByTrigger(bots, 'iniciar', 'instance-1'), exactBot);
  assert.equal(await findBotByTrigger(bots, 'outra mensagem', 'instance-1'), allBot);
});

test('an empty contains trigger does not match every message', async () => {
  const bot: Bot = {
    id: 'empty',
    instanceId: 'instance-1',
    enabled: true,
    triggerType: 'keyword',
    triggerOperator: 'contains',
    triggerValue: '',
  };
  assert.equal(await findBotByTrigger(repository([bot]), 'qualquer mensagem', 'instance-1'), null);
});
