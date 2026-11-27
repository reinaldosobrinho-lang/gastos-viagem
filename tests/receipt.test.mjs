import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, computeReceipt, findDuplicates } from '../docs/js/receipt.js';

const order = ['p1', 'p2', 'p3'];
const it = (cents, personIds, extra = {}) => ({ cents, qty: 1, personIds, qtyBy: null, ...extra });
const run = (o) => computeReceipt({ order, ...o });
const codes = (r) => r.errors.map((e) => e.code);

test('allocate: soma exata, maiores restos, empates para quem vem antes', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(allocate(10, [3, 1]), [8, 2]);           // 7,5 e 2,5 -> resto maior no 2º? 7,5=>7 r.5 ; 2,5=>2 r.5; empate: 1º
  assert.deepEqual(allocate(0, [1, 2]), [0, 0]);
  assert.deepEqual(allocate(7, [0, 5, 0]), [0, 7, 0]);
  assert.throws(() => allocate(5, [0, 0]));
  for (let seed = 1; seed < 300; seed++) {
    const total = (seed * 7919) % 100000;
    const w = [seed % 7, (seed * 3) % 5, (seed * 11) % 9 + 1];
    const out = allocate(total, w);
    assert.equal(out.reduce((a, b) => a + b, 0), total);
    assert.ok(out.every((x, i) => w[i] > 0 || x === 0));
  }
  // números grandes (evita erro de ponto flutuante)
  const big = allocate(9_999_999_999_999, [3, 3, 7]);
  assert.equal(big.reduce((a, b) => a + b, 0), 9_999_999_999_999);
});

test('nota simples: itens para pessoas diferentes + imposto adicionado + gorjeta + desconto', () => {
  // A: 30,00  B: 10,00  C: 10,00 (subtotal 50,00); imposto 5,00; gorjeta 10,00; desconto 5,00 => total 60,00
  const r = run({ items: [it(3000, ['p1']), it(1000, ['p2']), it(1000, ['p3'])], taxes: [{ cents: 500, included: false }], tipCents: 1000, discounts: [{ cents: 500 }], printedTotalCents: 6000 });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual([r.subtotal, r.taxAdded, r.discount, r.tip, r.computedTotal], [5000, 500, 500, 1000, 6000]);
  // proporcional: A 60% , B 20%, C 20% de (5 + 10 - 5 = 10) -> +6, +2, +2
  assert.deepEqual(r.personShares, { p1: 3600, p2: 1200, p3: 1200 });
  assert.equal(r.finalTotal, 6000);
  assert.equal(r.consumers.reduce((a, c) => a + c.cents, 0), 6000);
});
test('imposto já incluído no preço não é somado nem rateado (sem duplicar)', () => {
  const r = run({ items: [it(1200, ['p1']), it(800, ['p2'])], taxes: [{ cents: 200, included: true }], printedTotalCents: 2000 });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual([r.taxAdded, r.taxIncluded, r.computedTotal], [0, 200, 2000]);
  assert.deepEqual(r.personShares, { p1: 1200, p2: 800, p3: 0 });
  // se o usuário digitar o total somando o incluído de novo, o app bloqueia
  const wrong = run({ items: [it(1200, ['p1']), it(800, ['p2'])], taxes: [{ cents: 200, included: true }], printedTotalCents: 2200 });
  assert.deepEqual(codes(wrong), ['total_mismatch']); assert.equal(wrong.diff, 200);
});
test('item dividido entre várias pessoas (igual, com sobra de centavos)', () => {
  const r = run({ items: [it(1000, ['p1', 'p2', 'p3'])], printedTotalCents: 1000 });
  assert.deepEqual(r.personShares, { p1: 334, p2: 333, p3: 333 });
});
test('divisão por quantidade: 3 camisetas, 1 para A e 2 para B', () => {
  const r = run({ items: [{ cents: 9000, qty: 3, personIds: ['p1', 'p2'], qtyBy: { p1: 1, p2: 2 } }], printedTotalCents: 9000 });
  assert.ok(r.ok);
  assert.deepEqual(r.personShares, { p1: 3000, p2: 6000, p3: 0 });
  const bad = run({ items: [{ cents: 9000, qty: 3, personIds: ['p1', 'p2'], qtyBy: { p1: 1, p2: 1 } }], printedTotalCents: 9000 });
  assert.deepEqual(codes(bad), ['item_qty_sum']);
  assert.deepEqual([bad.errors[0].a, bad.errors[0].b], [2, 3]);
  const zero = run({ items: [{ cents: 9000, qty: 3, personIds: ['p1', 'p2'], qtyBy: { p1: 3, p2: 0 } }], printedTotalCents: 9000 });
  assert.deepEqual(codes(zero), ['item_qty_value']);
});
test('não adivinha: item sem pessoa bloqueia', () => {
  const r = run({ items: [it(1000, []), it(500, ['p1'])], printedTotalCents: 1500 });
  assert.equal(r.ok, false); assert.deepEqual(codes(r), ['item_unassigned']);
  assert.equal(r.consumers, null);
});
test('total impresso: obrigatório e precisa bater', () => {
  assert.deepEqual(codes(run({ items: [it(1000, ['p1'])] })), ['no_printed_total']);
  const r = run({ items: [it(1000, ['p1'])], printedTotalCents: 990 });
  assert.deepEqual(codes(r), ['total_mismatch']); assert.equal(r.diff, -10);
  assert.equal(r.consumers, null); assert.deepEqual(r.personShares, { p1: 1000, p2: 0, p3: 0 }); // prévia continua disponível
});
test('validações de itens e linhas', () => {
  assert.ok(codes(run({ items: [], printedTotalCents: 5 })).includes('no_items'));
  const r = run({ items: [{ cents: null, qty: 1, personIds: ['p1'], qtyBy: null }, { cents: 100, qty: 0, personIds: ['p1'], qtyBy: null }], taxes: [{ cents: null, included: false }], discounts: [{ cents: 0 }], printedTotalCents: 100 });
  assert.ok(codes(r).includes('item_price') && codes(r).includes('item_qty') && codes(r).filter((c) => c === 'line_value').length === 2);
  assert.ok(codes(run({ items: [it(1000, ['p1'])], discounts: [{ cents: 1500 }], printedTotalCents: -500 })).includes('discount_exceeds'));
});
test('moeda diferente: exige valor convertido e rateia a conversão pelas partes', () => {
  const base = { items: [it(3000, ['p1']), it(1000, ['p2'])], printedTotalCents: 4000, foreign: true };
  assert.deepEqual(codes(run(base)), ['no_converted']);
  const r = run({ ...base, convertedTotalCents: 22000 }); // US$ 220,00 por EUR 40,00
  assert.ok(r.ok);
  assert.equal(r.finalTotal, 22000);
  assert.deepEqual(r.consumers, [{ personId: 'p1', cents: 16500 }, { personId: 'p2', cents: 5500 }]);
  assert.deepEqual(r.personShares, { p1: 3000, p2: 1000, p3: 0 }); // moeda da nota
  const odd = run({ items: [it(100, ['p1']), it(100, ['p2']), it(100, ['p3'])], printedTotalCents: 300, foreign: true, convertedTotalCents: 1000 });
  assert.equal(odd.consumers.reduce((a, c) => a + c.cents, 0), 1000);
});
test('moeda igual: valor convertido é ignorado', () => {
  const r = run({ items: [it(100, ['p1'])], printedTotalCents: 100, convertedTotalCents: 999, foreign: false });
  assert.ok(r.ok); assert.equal(r.finalTotal, 100);
});
test('soma das partes sempre fecha com o total (aleatório)', () => {
  for (let s = 1; s < 200; s++) {
    const items = [it(100 + ((s * 37) % 5000), order.slice(0, 1 + (s % 3))), it(50 + ((s * 91) % 3000), order.slice(s % 3))];
    const sub = items[0].cents + items[1].cents;
    const tax = (s * 13) % 700; const tip = (s * 29) % 900; const disc = (s * 7) % Math.min(sub, 500);
    const r = run({ items, taxes: [{ cents: tax || 1, included: false }], tipCents: tip || null, discounts: disc ? [{ cents: disc }] : [], printedTotalCents: sub + (tax || 1) + tip - disc });
    assert.ok(r.ok, `${s}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.consumers.reduce((a, c) => a + c.cents, 0), r.finalTotal);
    assert.ok(r.consumers.every((c) => c.cents > 0));
  }
});
test('findDuplicates: mesma data e mesmo valor; ignora o próprio gasto', () => {
  const ex = [{ id: 'a', date: '2026-12-05', cents: 1000 }, { id: 'b', date: '2026-12-05', cents: 1001 }, { id: 'c', date: '2026-12-06', cents: 1000 }];
  assert.deepEqual(findDuplicates(ex, { date: '2026-12-05', cents: 1000 }).map((x) => x.id), ['a']);
  assert.deepEqual(findDuplicates(ex, { date: '2026-12-05', cents: 1000, excludeId: 'a' }), []);
});
