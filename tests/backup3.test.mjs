import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, validateBackup, SCHEMA_VERSION } from '../docs/js/backup.js';
import { computeReceipt } from '../docs/js/receipt.js';
import { splitEqual } from '../docs/js/split.js';
import { DB_VERSION } from '../docs/js/db.js';

const IDS = ['p1', 'p2', 'p3'];
const people = IDS.map((id, i) => ({ id, name: ['Ana', 'Bia', 'Caio'][i] }));
const trip = { name: 'V', start: '2026-12-01', end: '2026-12-10', currency: 'USD' };

// nota confirmada: A 30,00 | B 10,00 + imposto 5,00 + gorjeta 6,00 - desconto 1,00 => total 50,00 (US$)
const items = [
  { id: 'i1', name: 'Camisa', qty: 1, cents: 3000, personIds: ['p1'], qtyBy: null },
  { id: 'i2', name: 'Meia', qty: 2, cents: 1000, personIds: ['p2', 'p3'], qtyBy: { p2: 1, p3: 1 } },
];
const taxes = [{ name: 'Tax', cents: 500, included: false }, { name: 'IVA', cents: 100, included: true }];
const discounts = [{ name: 'Cupom', cents: 100 }];
const comp = computeReceipt({ items, taxes, discounts, tipCents: 600, printedTotalCents: 5000 + 500 + 600 - 100 - 1000 + 1000, order: IDS });
const receipt = { id: 'r1', status: 'confirmed', createdAt: '', store: 'Loja', date: '2026-12-03', currency: 'USD', category: 'compras', activityId: null, expenseId: 'x1',
  hasPhoto: true, tipCents: 600, printedTotalCents: comp.computedTotal, convertedTotalCents: null, items, taxes, discounts };
const final = computeReceipt({ items, taxes, discounts, tipCents: 600, printedTotalCents: comp.computedTotal, order: IDS });
const expense = { id: 'x1', date: '2026-12-03', cents: final.finalTotal, store: 'Loja', category: 'compras', description: 'Nota fiscal', splitMode: 'custom', createdAt: '', activityId: null, receiptId: 'r1', consumers: final.consumers };
const pending = { id: 'r2', status: 'pending', createdAt: '', store: '', date: '', currency: 'EUR', category: 'compras', activityId: null, expenseId: null, hasPhoto: true,
  tipCents: null, printedTotalCents: null, convertedTotalCents: null, items: [{ id: 'i9', name: '', qty: 1, cents: null, personIds: [], qtyBy: null }], taxes: [], discounts: [] };
const normal = { id: 'x2', date: '2026-12-04', cents: 900, store: '', category: 'outros', description: '', splitMode: 'equal', createdAt: '', activityId: null, receiptId: null, consumers: splitEqual(900, IDS) };
const state = { trip, people, entries: [{ id: 'e1', date: '2026-11-30', cents: 100000, description: '', createdAt: '' }], activities: [], expenses: [expense, normal], receipts: [receipt, pending] };
const good = () => JSON.parse(JSON.stringify(buildBackup(state, new Date(2026, 11, 5))));

test('schema do backup == versão do banco (3)', () => { assert.equal(SCHEMA_VERSION, DB_VERSION); assert.equal(SCHEMA_VERSION, 3); });
test('nota de exemplo fecha (sanidade do teste)', () => {
  assert.ok(final.ok, JSON.stringify(final.errors));
  assert.equal(final.finalTotal, 3000 + 1000 + 500 + 600 - 100);
});
test('backup NÃO leva fotos: hasPhoto sai false e nenhum dado binário', () => {
  const b = good();
  assert.ok(b.receipts.every((r) => r.hasPhoto === false));
  assert.ok(!JSON.stringify(b).includes('bytes'));
  const r = validateBackup(b);
  assert.ok(r.ok, r.errors.join('|'));
  assert.ok(r.data.receipts.every((x) => x.hasPhoto === false));
  assert.equal(r.summary.receipts, 2);
});
test('ida e volta: nota confirmada, pendente e vínculo com o gasto', () => {
  const r = validateBackup(good());
  assert.ok(r.ok, r.errors.join('|'));
  assert.deepEqual(r.data.expenses.map((x) => x.receiptId), ['r1', null]);
  assert.deepEqual(r.data.receipts.find((x) => x.id === 'r1').items.map((i) => i.cents), [3000, 1000]);
  assert.equal(r.data.receipts.find((x) => x.id === 'r2').status, 'pending');
});
test('backups antigos (schema 1 e 2) restauram com lista de notas vazia', () => {
  const v2 = good(); v2.schema = 2; delete v2.receipts; v2.expenses = [v2.expenses[1]];
  const r2 = validateBackup(v2); assert.ok(r2.ok, r2.errors.join('|')); assert.deepEqual(r2.data.receipts, []);
  const v1 = good(); v1.schema = 1; delete v1.receipts; delete v1.activities; v1.expenses = [v1.expenses[1]]; v1.expenses.forEach((x) => { delete x.activityId; delete x.receiptId; });
  const r1 = validateBackup(v1); assert.ok(r1.ok, r1.errors.join('|'));
});
test('schema 3 sem a lista de notas é rejeitado', () => { const b = good(); delete b.receipts; assert.equal(validateBackup(b).ok, false); });
const bad = {
  'gasto da nota com valor diferente': (b) => { b.expenses[0].cents += 1; b.expenses[0].consumers[0].cents += 1; },
  'gasto da nota com rateio diferente': (b) => { b.expenses[0].consumers[0].cents -= 1; b.expenses[0].consumers[1].cents += 1; },
  'nota confirmada sem gasto': (b) => { b.receipts[0].expenseId = null; },
  'nota confirmada aponta gasto inexistente': (b) => { b.receipts[0].expenseId = 'nao-existe'; },
  'gasto aponta nota inexistente': (b) => { b.expenses[1].receiptId = 'nao-existe'; },
  'gasto aponta nota pendente': (b) => { b.expenses[1].receiptId = 'r2'; },
  'dois gastos para a mesma nota': (b) => { b.expenses[1].receiptId = 'r1'; },
  'nota pendente com gasto': (b) => { b.receipts[1].expenseId = 'x2'; },
  'nota confirmada com total impresso errado': (b) => { b.receipts[0].printedTotalCents += 1; },
  'item atribuído a pessoa inexistente': (b) => { b.receipts[0].items[0].personIds = ['zz']; },
  'quantidade por pessoa que não soma': (b) => { b.receipts[0].items[1].qtyBy = { p2: 1, p3: 2 }; },
  'item com valor negativo': (b) => { b.receipts[1].items[0].cents = -5; },
  'status inválido': (b) => { b.receipts[1].status = 'ok'; },
  'moeda inválida': (b) => { b.receipts[1].currency = 'ZZZ'; },
  'id repetido': (b) => { b.receipts[1].id = 'r1'; },
  'imposto sem flag booleana': (b) => { b.receipts[0].taxes[0].included = 'sim'; },
  'itens demais': (b) => { b.receipts[1].items = Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, name: '', qty: 1, cents: null, personIds: [], qtyBy: null })); },
  'atividade inexistente': (b) => { b.receipts[1].activityId = 'nao-existe'; },
};
for (const [nome, fn] of Object.entries(bad)) {
  test(`rejeita: ${nome}`, () => { const b = good(); fn(b); const r = validateBackup(b); assert.equal(r.ok, false); assert.ok(r.errors.length); });
}
test('nota em moeda estrangeira confirmada exige o valor convertido e bate com o gasto', () => {
  const it2 = [{ id: 'i1', name: 'Jaqueta', qty: 1, cents: 12000, personIds: ['p1', 'p2'], qtyBy: null }];
  const c = computeReceipt({ items: it2, printedTotalCents: 12000, convertedTotalCents: 70001, foreign: true, order: IDS });
  assert.ok(c.ok);
  const rc = { ...receipt, id: 'r3', currency: 'EUR', expenseId: 'x3', hasPhoto: false, items: it2, taxes: [], discounts: [], tipCents: null, printedTotalCents: 12000, convertedTotalCents: 70001 };
  const ex = { ...expense, id: 'x3', cents: 70001, receiptId: 'r3', consumers: c.consumers };
  const b = JSON.parse(JSON.stringify(buildBackup({ ...state, receipts: [rc], expenses: [ex, normal] }, new Date(2026, 11, 5))));
  assert.ok(validateBackup(b).ok);
  b.receipts[0].convertedTotalCents = null;
  assert.equal(validateBackup(b).ok, false);
});
