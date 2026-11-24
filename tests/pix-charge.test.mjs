import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createPixCharge } = require('../dist/utils/pix.js');

test('generates a distinct static Pix code containing the requested amount and recipient', () => {
  const input = {
    key: '123e4567-e12b-12d1-a456-426655440000',
    amount: '25,90',
    merchantName: 'Paróquia Santa Luzia',
    merchantCity: 'Belém',
  };
  const first = createPixCharge(input);
  const second = createPixCharge(input);
  assert.equal(first.amount, '25.90');
  assert.ok(first.code.includes('540525.90'));
  assert.ok(first.code.includes('5920PAROQUIA SANTA LUZIA'));
  assert.ok(first.code.includes('6005BELEM'));
  assert.ok(first.code.includes(input.key));
  assert.match(first.code, /6304[0-9A-F]{4}$/);
  assert.notEqual(first.txid, second.txid);
  assert.notEqual(first.code, second.code);
});

test('rejects malformed amounts and keys', () => {
  const input = { key: 'chave@example.com', amount: '1.00', merchantName: 'Loja', merchantCity: 'Belem' };
  assert.throws(() => createPixCharge({ ...input, amount: '0.00' }));
  assert.throws(() => createPixCharge({ ...input, amount: '1.001' }));
  assert.throws(() => createPixCharge({ ...input, key: 'invalid key' }));
});
