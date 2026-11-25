import assert from 'node:assert/strict';
import test from 'node:test';

import { SendButtonsDto } from '../src/api/dto/sendMessage.dto';
import { buttonFallbackText } from '../src/utils/buttonFallbackText';

test('copy-code message includes a visible, selectable code', () => {
  const message = {
    number: '5599999999999',
    title: 'Seu código',
    buttons: [{ type: 'copy', displayText: 'Copiar código', copyCode: 'ABC123' }],
  } as SendButtonsDto;

  assert.equal(buttonFallbackText(message), 'Seu código\n\nCopiar código:\nABC123');
});

test('Pix copy-and-paste message also includes the payment page URL', () => {
  const message = {
    number: '5599999999999',
    title: 'Pagamento Pix',
    description: 'Valor: R$ 10,00',
    buttons: [
      { type: 'copy', displayText: 'Copiar código Pix', copyCode: '000201PIXCODE' },
      { type: 'url', displayText: 'Ver pagamento', url: 'https://example.com/pagamento' },
    ],
  } as SendButtonsDto;

  assert.equal(
    buttonFallbackText(message),
    'Pagamento Pix\n\nValor: R$ 10,00\n\nCopiar código Pix:\n000201PIXCODE\n\nVer pagamento:\nhttps://example.com/pagamento',
  );
});

test('ordinary buttons do not create an extra text message', () => {
  const message = {
    number: '5599999999999',
    title: 'Opções',
    buttons: [{ type: 'reply', displayText: 'Sim', id: 'yes' }],
  } as SendButtonsDto;

  assert.equal(buttonFallbackText(message), null);
});

test('a payment link with a URL button does not create a duplicate text message', () => {
  const message = {
    number: '5599999999999',
    title: 'Pagamento Pix',
    description: 'Valor: R$ 22,00',
    buttons: [{ type: 'url', displayText: 'Abrir pagamento', url: 'https://example.com/manager/payment/inst/abc' }],
  } as SendButtonsDto;

  assert.equal(buttonFallbackText(message), null);
});
