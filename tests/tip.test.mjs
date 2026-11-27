import test from 'node:test';
import assert from 'node:assert/strict';
import { tipOptions, normalizePcts, roundDivHalfUp, DEFAULT_TIP_PCTS } from '../docs/js/tip.js';

const view = (r) => r.options.map((o) => [o.pct, o.tipCents, o.totalCents]);

test('padrão: 18, 20 e 25 %', () => assert.deepEqual(DEFAULT_TIP_PCTS, [18, 20, 25]));
test('sobre o valor antes do imposto (conta US$ 87,40 com imposto US$ 6,40 -> base 81,00)', () => {
  const r = tipOptions({ billCents: 8740, taxCents: 640 });
  assert.ok(r.ok); assert.equal(r.base, 8100);
  assert.deepEqual(view(r), [[18, 1458, 10198], [20, 1620, 10360], [25, 2025, 10765]]);
});
test('sobre a conta inteira (sem excluir o imposto)', () => {
  const r = tipOptions({ billCents: 8740, taxCents: 640, preTax: false });
  assert.equal(r.base, 8740);
  assert.deepEqual(view(r), [[18, 1573, 10313], [20, 1748, 10488], [25, 2185, 10925]]); // 18% = 15,732 -> 15,73
});
test('sem imposto informado: base = conta, mesmo com preTax ligado', () => {
  const r = tipOptions({ billCents: 5000 });
  assert.equal(r.base, 5000); assert.deepEqual(view(r), [[18, 900, 5900], [20, 1000, 6000], [25, 1250, 6250]]);
});
test('arredondamento: meio centavo sobe, abaixo de meio desce', () => {
  assert.equal(roundDivHalfUp(15750, 100), 158); // 157,5
  assert.equal(roundDivHalfUp(15749, 100), 157);
  assert.equal(roundDivHalfUp(0, 100), 0);
  assert.equal(tipOptions({ billCents: 1050, pcts: [15, 15, 15] }).options[0].tipCents, 158); // 1050 * 15% = 157,5
});
test('percentuais personalizados e zero', () => {
  const r = tipOptions({ billCents: 10000, pcts: [0, 15, 100] });
  assert.deepEqual(view(r), [[0, 0, 10000], [15, 1500, 11500], [100, 10000, 20000]]);
});
test('erros: sem conta, imposto inválido ou maior que a conta', () => {
  for (const b of [0, -5, null, undefined, 1.5, NaN]) assert.equal(tipOptions({ billCents: b }).code, 'no_bill');
  assert.equal(tipOptions({ billCents: 1000, taxCents: -1 }).code, 'bad_tax');
  assert.equal(tipOptions({ billCents: 1000, taxCents: 1000 }).code, 'tax_too_high');
  assert.equal(tipOptions({ billCents: 1000, taxCents: 1500 }).code, 'tax_too_high');
});
test('normalizePcts: 3 inteiros de 0 a 100', () => {
  assert.deepEqual(normalizePcts([15, '18', 20]), [15, 18, 20]);
  for (const bad of [[15, 18], [15, 18, 20, 25], [15, 18, 101], [15, 18, -1], [15, 18, 20.5], [15, '', 20], ['a', 1, 2], null, 'x']) assert.equal(normalizePcts(bad), null, JSON.stringify(bad));
});
test('o total é sempre conta + gorjeta (sem diferença de centavos)', () => {
  for (let bill = 100; bill < 30000; bill += 733) for (const tax of [0, 7, 99]) {
    const r = tipOptions({ billCents: bill, taxCents: tax });
    assert.ok(r.ok);
    for (const o of r.options) { assert.equal(o.totalCents, bill + o.tipCents); assert.ok(Math.abs(o.tipCents - (r.base * o.pct) / 100) <= 0.5 + 1e-9); }
  }
});
