// Notas fiscais (lançamento manual com foto de referência) no Chromium, iPhone 13 emulado. Dados FICTÍCIOS.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e-notas.cjs [pasta-de-screenshots]
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..', 'docs');
const shots = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'x', 'cache-control': 'no-store' }); r.end(fs.readFileSync(f)); });
const pad = (n) => String(n).padStart(2, '0');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const norm = (s) => s.replace(/\s/g, ' ');

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });
  const text = async () => norm(await page.locator('#app').innerText());
  const closed = () => page.waitForSelector('#sheet[hidden]', { state: 'attached' });
  const toastHas = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('toast').innerText.replace(/\s/g, ' ')), re.source);
  const item = (i) => page.locator(`.rc-item[data-i="${i}"]`);
  const chipOf = (i, pid) => item(i).locator(`[data-p="${pid}"]`);

  await page.goto(`http://localhost:${server.address().port}/`); await page.waitForSelector('#setupForm');
  await page.fill('[name=name]', 'Teste'); await page.fill('[name=start]', addDays(-1)); await page.fill('[name=end]', addDays(5));
  await page.fill('[name=p0]', 'Ana'); await page.fill('[name=p1]', 'Bia'); await page.fill('[name=p2]', 'Caio');
  await page.click('#setupForm button[type=submit]'); await page.waitForSelector('#tabs:not([hidden])');
  await page.click('[data-tab=saldo]'); await page.click('[data-act=new-entry]'); await page.fill('#eAmount', '3000'); await page.click('#entForm button[type=submit]'); await closed();

  // foto fictícia grande (2400x3200) para testar a compressão
  const dataUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 3200; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 2400, 3200); x.fillStyle = '#000'; x.font = '120px sans-serif'; for (let i = 0; i < 20; i++) x.fillText(`ITEM ${i}  9,99`, 100, 200 + i * 140); return c.toDataURL('image/png'); });
  const photo = path.join(os.tmpdir(), 'nota-ficticia.png'); fs.writeFileSync(photo, Buffer.from(dataUrl.split(',')[1], 'base64'));

  /* 1) foto -> nota pendente (não entra no saldo) */
  await page.click('[data-tab=gastos]'); await page.click('[data-act=new-note]');
  assert.match(norm(await page.locator('#sheet').innerText()), /nada entra no saldo até você confirmar/);
  await page.setInputFiles('#galPicker', photo);
  await page.waitForSelector('#rcForm'); await page.waitForSelector('.rc-thumb');
  const dim = await page.locator('.rc-thumb').evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
  assert.ok(Math.max(dim.w, dim.h) <= 1600 && dim.h > dim.w, `foto comprimida (${dim.w}x${dim.h})`);
  assert.match(norm(await page.locator('#rcForm').innerText()), /Pendente: ainda não entra no saldo/);
  await page.click('[data-view-photo] >> nth=1'); await page.waitForSelector('#vImg'); await page.click('#vClose');
  // confirmar vazio -> bloqueado com lista do que falta
  await page.click('#rcForm button[type=submit]');
  assert.match(norm(await page.locator('#rcErr').innerText()), /Adicione ao menos um item/);

  /* 2) itens, quantidade dividida, impostos, desconto, gorjeta */
  await page.fill('#rcStore', 'Loja Teste');
  await page.click('[data-add-item]');
  await item(0).locator('.it-name').fill('Camisa'); await item(0).locator('.it-price').fill('30');
  await page.click('[data-add-item]');
  await item(1).locator('.it-name').fill('Meia'); await item(1).locator('.it-price').fill('15');
  await item(1).locator('.it-qty').fill('3'); await item(1).locator('.it-qty').dispatchEvent('change');
  await page.click('[data-add-item]'); // item 3 sem pessoa -> bloqueia
  await item(2).locator('.it-name').fill('Sem dono'); await item(2).locator('.it-price').fill('1');
  await chipOf(0, 'p1').click();
  await chipOf(1, 'p2').click(); await chipOf(1, 'p3').click();
  await item(1).locator('[data-qtymode]').click();
  await item(1).locator('.it-qtyby[data-pid=p2]').fill('1'); await item(1).locator('.it-qtyby[data-pid=p3]').fill('1');
  let sum = norm(await page.locator('#rcSummary').innerText());
  assert.match(sum, /Sem dono: escolha para quem é/); assert.match(sum, /Meia: as quantidades somam 2, mas o item tem 3/);
  await item(1).locator('.it-qtyby[data-pid=p3]').fill('2');
  await item(2).locator('[data-rm-item]').click();
  await page.click('[data-add-tax]'); await page.locator('.tx-name').first().fill('Sales tax'); await page.locator('.tx-val').first().fill('4,50');
  await page.click('[data-add-tax]'); await page.locator('.tx-name').nth(1).fill('IVA'); await page.locator('.tx-val').nth(1).fill('1'); await page.locator('.tx-inc').nth(1).check();
  await page.click('[data-add-disc]'); await page.locator('.ds-val').first().fill('1');
  await page.fill('#rcTip', '3');
  await page.fill('#rcTotal', '50');
  sum = norm(await page.locator('#rcSummary').innerText());
  assert.match(sum, /Total calculado\s*US\$ 51,50/); assert.match(sum, /Impostos já incluídos \(não somam\)\s*US\$ 1,00/);
  assert.match(sum, /As partes somam US\$ 51,50, mas o total da nota é US\$ 50,00 \(sobram US\$ 1,50\)/);
  await page.click('#rcForm button[type=submit]');
  assert.match(norm(await page.locator('#rcErr').innerText()), /sobram US\$ 1,50/); // bloqueado
  await page.fill('#rcTotal', '51,50');
  sum = norm(await page.locator('#rcSummary').innerText());
  assert.match(sum, /Tudo fecha/);
  assert.match(sum, /Ana\s*US\$ 34,33/); assert.match(sum, /Bia\s*US\$ 5,72/); assert.match(sum, /Caio\s*US\$ 11,45/);
  await shot('n1-revisao');

  /* 3) salvar como pendente: não entra no saldo */
  await page.click('#rcDraft'); await closed();
  assert.match(await text(), /Notas pendentes \(1\)/); assert.match(await text(), /Ainda NÃO entram no saldo/);
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 3\.000,00/);
  await page.click('[data-tab=gastos]'); await page.click('[data-act=open-receipt]');
  await page.waitForSelector('#rcForm');
  assert.equal(await page.locator('.rc-item').count(), 2); // dados preservados
  assert.equal(await item(1).locator('.it-qtyby[data-pid=p3]').inputValue(), '2');
  assert.match(norm(await page.locator('#rcSummary').innerText()), /Tudo fecha/);

  /* 4) confirmar: um único gasto, saldo diminui uma vez */
  await page.click('#rcForm button[type=submit]'); await closed();
  await toastHas(/Nota lançada: US\$ 51,50/);
  let t = await text(); assert.doesNotMatch(t, /Notas pendentes/);
  assert.equal(await page.locator('.item').count(), 1); assert.match(t, /🧾 Loja Teste/);
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 2\.948,50/);
  await page.click('[data-tab=gastos]'); await shot('n2-gastos');

  /* 5) duplicidade: mesma data e mesmo valor */
  await page.click('[data-act=new-note]'); await page.click('#nNone'); await page.waitForSelector('#rcForm');
  await page.fill('#rcStore', 'Outra loja'); await page.click('[data-add-item]');
  await item(0).locator('.it-price').fill('51,50'); await chipOf(0, 'p1').click(); await page.fill('#rcTotal', '51,50');
  assert.match(norm(await page.locator('#rcForm').innerText()), /Sem foto/);
  await page.click('#rcForm button[type=submit]'); await page.waitForSelector('.dlg');
  assert.match(norm(await page.locator('.dlg').innerText()), /Possível nota duplicada[\s\S]*Loja Teste/);
  await page.click('[data-cancel]');
  assert.equal(await page.locator('#rcForm').count(), 1); // continua na revisão, nada lançado
  await page.click('#rcForm button[type=submit]'); await page.waitForSelector('.dlg'); await page.click('[data-ok]'); await closed();
  assert.equal(await page.locator('.item').count(), 2);

  /* 6) moeda diferente exige valor convertido */
  await page.click('[data-act=new-note]'); await page.click('#nNone'); await page.waitForSelector('#rcForm');
  await page.fill('#rcStore', 'Loja Euro'); await page.selectOption('#rcCur', 'EUR');
  await page.click('[data-add-item]'); await item(0).locator('.it-price').fill('100'); await chipOf(0, 'p2').click(); await page.fill('#rcTotal', '100');
  assert.match(norm(await page.locator('#rcSummary').innerText()), /Informe o valor convertido em USD/);
  await page.click('#rcForm button[type=submit]');
  assert.match(norm(await page.locator('#rcErr').innerText()), /valor convertido em USD/);
  await page.fill('#rcConv', '115,50'); assert.match(norm(await page.locator('#rcSummary').innerText()), /Tudo fecha/);
  await page.click('#rcForm button[type=submit]'); await closed();
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 2\.781,50/); // 3000 - 51,50 - 51,50 - 115,50

  /* 7) editar nota confirmada pelo gasto: continua um único gasto */
  await page.click('[data-tab=gastos]');
  assert.equal(await page.locator('.item').count(), 3);
  await page.locator('.item', { hasText: 'Loja Teste' }).click(); await page.waitForSelector('#rcForm');
  assert.match(norm(await page.locator('#rcForm').innerText()), /Nota confirmada: gera um único gasto/);
  await page.fill('#rcTip', '4'); await page.fill('#rcTotal', '52,50');
  await page.click('#rcForm button[type=submit]'); await closed();
  assert.equal(await page.locator('.item').count(), 3);
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 2\.780,50/);

  /* 8) backup: dados sim, fotos não */
  await page.click('[data-tab=ajustes]'); assert.match(await text(), /não inclui as fotos das notas fiscais/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  const bf = path.join(os.tmpdir(), 'bk-notas.json'); await dl.saveAs(bf);
  const raw = fs.readFileSync(bf, 'utf8'); const bk = JSON.parse(raw);
  assert.equal(bk.schema, 3); assert.equal(bk.receipts.length, 3);
  assert.ok(bk.receipts.every((r) => r.hasPhoto === false)); assert.ok(!/bytes|data:image/.test(raw));
  assert.equal(bk.expenses.filter((x) => x.receiptId).length, 3);
  // excluir a nota em EUR: o gasto some e o saldo volta
  await page.click('[data-tab=gastos]'); await page.locator('.item', { hasText: 'Loja Euro' }).click();
  await page.click('#rcDel'); assert.match(norm(await page.locator('.dlg').innerText()), /Remove a nota e o gasto de US\$ 115,50/); await page.click('[data-ok]'); await closed();
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 2\.896,00/);
  // restaurar: avisa sobre fotos e traz as notas de volta (sem foto)
  await page.click('[data-tab=ajustes]'); await page.setInputFiles('#filePicker', bf);
  await page.waitForSelector('.dlg'); assert.match(norm(await page.locator('.dlg').innerText()), /não inclui fotos/); await page.click('[data-ok]'); await page.waitForTimeout(300);
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 2\.780,50/);
  await page.click('[data-tab=gastos]'); await page.locator('.item', { hasText: 'Loja Teste' }).click(); await page.waitForSelector('#rcForm');
  assert.match(norm(await page.locator('#rcForm').innerText()), /Sem foto/);
  assert.equal(await item(1).locator('.it-qtyby[data-pid=p3]').inputValue(), '2');
  await page.click('#sheet [data-close]');

  /* 9) excluir pendente apaga a foto */
  await page.click('[data-act=new-note]'); await page.evaluate(() => { document.getElementById('galPicker').value = ''; }); await page.setInputFiles('#galPicker', photo); await page.waitForSelector('.rc-thumb');
  await page.click('#rcDel'); await page.click('[data-ok]'); await closed();
  assert.doesNotMatch(await text(), /Notas pendentes/);
  const photos = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('gastos-viagem'); r.onsuccess = () => { const q = r.result.transaction('receiptPhotos').objectStore('receiptPhotos').count(); q.onsuccess = () => res(q.result); }; }));
  assert.equal(photos, 0);
  console.log('erros de console/página:', errors.length ? errors : 'nenhum');
  assert.equal(errors.length, 0);
  console.log('E2E NOTAS OK');
  await browser.close(); server.close();
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
