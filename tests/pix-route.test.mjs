import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
require('express-async-errors');
const express = require('express');
const { PixRouter } = require('../dist/api/routes/pix.router.js');

test('payment link returns the exact generated code and rejects a changed signature', async () => {
  const instance = { name: 'pix-test', token: 'test-instance-token', integration: 'WHATSAPP-BAILEYS' };
  const repository = { instance: { findUnique: async ({ where }) => where.name === instance.name ? instance : null } };
  const app = express();
  app.use(express.json());
  app.use('/pix', new PixRouter(repository, (_req, _res, next) => next()).router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const create = await fetch(`${base}/pix/create/${instance.name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: '123e4567-e12b-12d1-a456-426655440000', amount: '25.00', merchantName: 'Loja', merchantCity: 'Belem' }),
    });
    assert.equal(create.status, 201);
    const charge = await create.json();
    const token = charge.paymentUrl.split('/').pop();
    const read = await fetch(`${base}/pix/${token}`);
    assert.equal(read.status, 200);
    const publicCharge = await read.json();
    assert.equal(publicCharge.code, charge.code);
    assert.equal(publicCharge.amount, '25.00');
    assert.equal(publicCharge.key, '123e4567-e12b-12d1-a456-426655440000');
    const parts = token.split('.');
    const changed = `${parts[0]}.${parts[1][0] === 'A' ? 'B' : 'A'}${parts[1].slice(1)}`;
    const tampered = await fetch(`${base}/pix/${changed}`);
    assert.equal(tampered.status, 400);
  } finally {
    server.close();
  }
});
