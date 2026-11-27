// Fluxo da Fase 2 no Chromium (iPhone 13 emulado), incluindo a ATUALIZAÇÃO da v1 (primeiro commit) para a versão atual
// com dados já gravados. Não substitui testar no iPhone/Safari real.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e-fase2.cjs [pasta-de-screenshots]
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const { execSync } = require('child_process');
const repo = path.join(__dirname, '..');
const shots = process.argv[2];
const v1 = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-'));
const first = execSync('git rev-list --max-parents=0 HEAD', { cwd: repo }).toString().trim().split('\n')[0];
execSync(`git archive ${first} docs | tar -x -C ${v1}`, { cwd: repo });
let root = path.join(v1, 'docs');
const current = path.join(repo, 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(fs.readFileSync(f));
});
const pad = (n) => String(n).padStart(2, '0');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const norm = (s) => s.replace(/\s/g, ' ');

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false });
  const text = async () => norm(await page.locator('#app').innerText());
  const closed = () => page.waitForSelector('#sheet[hidden]', { state: 'attached' });

  /* ---- 1) versão 1 com dados ---- */
  await page.goto(url); await page.waitForSelector('#setupForm');
  assert.equal(await page.locator('[data-tab=crono]').count(), 0, 'v1 não tem cronograma');
  await page.fill('[name=name]', 'Teste'); await page.fill('[name=start]', addDays(-1)); await page.fill('[name=end]', addDays(4));
  await page.fill('[name=p0]', 'Ana'); await page.fill('[name=p1]', 'Bia'); await page.fill('[name=p2]', 'Caio');
  await page.click('#setupForm button[type=submit]'); await page.waitForSelector('#tabs:not([hidden])');
  await page.click('[data-tab=saldo]'); await page.click('[data-act=new-entry]'); await page.fill('#eAmount', '1000'); await page.click('#entForm button[type=submit]'); await closed();
  await page.click('[data-tab=gastos]'); await page.click('[data-act=new-expense]');
  await page.fill('#fAmount', '50'); await page.fill('#fStore', 'Antigo'); await page.click('[data-all]'); await page.click('#expForm button[type=submit]'); await closed();
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller);

  /* ---- 2) publica a versão atual e atualiza pelo banner ---- */
  root = current;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForSelector('#banner:not([hidden])');
  assert.match(await page.locator('#banner').innerText(), /Nova versão/);
  await Promise.all([page.waitForEvent('load'), page.click('#banner button')]);
  await page.waitForSelector('[data-tab=crono]');
  await page.click('[data-tab=painel]');
  assert.match(await text(), /Saldo disponível\s*US\$ 950,00/, 'dados da v1 preservados após migração');
  await page.click('[data-tab=gastos]'); assert.match(await text(), /Antigo/);
  await page.click('[data-tab=ajustes]'); assert.match(await text(), /Versão 1\.1\.0/);

  /* ---- 3) cronograma ---- */
  await page.click('[data-tab=crono]');
  assert.match(await text(), /sem previsão/);
  assert.match(await text(), /refeições e transporte/);
  await page.click('[data-act=new-activity]');
  await page.fill('#aTitle', 'Parque <i>X</i>'); await page.fill('#aDate', addDays(1));
  await page.fill('#aMin', '300'); await page.fill('#aMax', '100'); await page.click('[data-all]');
  await page.click('#actForm button[type=submit]');
  assert.match(await page.locator('#aErr').innerText(), /mínimo não pode ser maior/);
  await page.fill('#aMin', '100'); await page.fill('#aMax', '300');
  await shot('f2-1-atividade');
  assert.deepEqual((await page.locator('[data-prev]').allInnerTexts()).map(norm), ['US$ 33,34 a US$ 100,00', 'US$ 33,33 a US$ 100,00', 'US$ 33,33 a US$ 100,00']);
  await page.click('[data-mode=custom]');
  const c = page.locator('input.cust');
  const fill6 = async (v) => { for (let i = 0; i < 6; i++) await c.nth(i).fill(String(v[i])); };
  await fill6([50, 150, 30, 50, 25, 100]); // mínimos somam 105
  await page.click('#actForm button[type=submit]');
  assert.match(await page.locator('#aErr').innerText(), /mínimos por pessoa não fecha/);
  await fill6([50, 150, 25, 50, 25, 75]); // mínimos ok (100), máximos somam 275
  await page.click('#actForm button[type=submit]');
  assert.match(await page.locator('#aErr').innerText(), /máximos por pessoa não fecha/);
  await fill6([50, 150, 25, 50, 25, 100]); // 100 e 300
  await page.click('#actForm button[type=submit]'); await closed();
  assert.match(await text(), /Parque <i>X<\/i>/); // escapado
  let t = await text();
  assert.match(t, /Previsão restante \(mín\. a máx\.\)\s*US\$ 100,00 a US\$ 300,00/);
  assert.match(t, /cenário mínimo\s*US\$ 850,00/); assert.match(t, /cenário máximo\s*US\$ 650,00/);
  assert.match(t, /Total estimado \(real \+ restante\)\s*US\$ 150,00 a US\$ 350,00/);

  // gasto vinculado: 40,00 -> restante 60 a 260, total estimado não conta duas vezes
  await page.locator('.item', { hasText: 'Parque' }).first().click();
  await page.click('#aAddExp');
  assert.equal(await page.locator('#fAct').inputValue() !== '', true, 'atividade pré-selecionada');
  await page.fill('#fAmount', '40'); await page.click('[data-pid=p1]'); await page.click('#expForm button[type=submit]'); await closed();
  await page.click('[data-tab=crono]'); t = await text();
  assert.match(t, /Previsão restante \(mín\. a máx\.\)\s*US\$ 60,00 a US\$ 260,00/);
  assert.match(t, /Total estimado \(real \+ restante\)\s*US\$ 150,00 a US\$ 350,00/);
  assert.match(t, /Ana\s*Já consumido\s*US\$ 56,67/); // 16,67 (parte do gasto antigo de 50) + 40,00 do gasto vinculado
  await shot('f2-2-crono');

  // alerta: previsão que o saldo não cobre
  await page.click('[data-act=new-activity]'); await page.fill('#aTitle', 'Compras'); await page.fill('#aDate', addDays(2));
  await page.fill('#aMin', '500'); await page.fill('#aMax', '2000'); await page.click('[data-all]'); await page.click('#actForm button[type=submit]'); await closed();
  t = await text();
  assert.match(t, /cobre o mínimo, mas não o máximo/);
  await page.click('[data-tab=painel]'); assert.match(await text(), /cobre o mínimo, mas não o máximo/);
  await shot('f2-3-painel');

  // atividade atrasada: outra com data passada pendente
  await page.click('[data-tab=crono]'); await page.click('[data-act=new-activity]');
  await page.fill('#aTitle', 'Ontem'); await page.fill('#aDate', addDays(-1)); await page.fill('#aMin', '10'); await page.fill('#aMax', '20');
  await page.click('[data-all]'); await page.click('#actForm button[type=submit]'); await closed();
  assert.match(await text(), /1 atividade de dia passado ainda pendente/);

  /* ---- 4) backup com cronograma ---- */
  await page.click('[data-tab=ajustes]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  const file = path.join(os.tmpdir(), 'bk2.json'); await dl.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(bk.schema, 2); assert.equal(bk.activities.length, 3);
  assert.equal(bk.expenses.filter((x) => x.activityId).length, 1);
  // exclui "Parque": gasto continua, perde o vínculo
  await page.click('[data-tab=crono]'); await page.locator('.item', { hasText: 'Parque' }).first().click(); await page.click('#aDel');
  assert.match(await page.locator('.dlg').innerText(), /continuam lançados/); await page.click('[data-ok]'); await closed();
  await page.click('[data-tab=painel]'); assert.match(await text(), /Saldo disponível\s*US\$ 910,00/); // saldo intacto
  // restaura o backup: Parque e vínculo voltam
  await page.click('[data-tab=ajustes]'); await page.setInputFiles('#filePicker', file);
  await page.waitForSelector('.dlg'); assert.match(await page.locator('.dlg').innerText(), /3 atividade/); await page.click('[data-ok]'); await page.waitForTimeout(300);
  await page.click('[data-tab=crono]'); assert.match(await text(), /Parque <i>X<\/i>/);
  await page.reload(); await page.waitForSelector('[data-tab=crono]'); await page.click('[data-tab=crono]');
  assert.match(await text(), /Previsão restante \(mín\. a máx\.\)/);

  /* ---- 5) restaura um backup antigo (schema 1) ---- */
  const old = JSON.parse(JSON.stringify(bk)); old.schema = 1; delete old.activities; old.expenses.forEach((x) => delete x.activityId);
  const oldFile = path.join(os.tmpdir(), 'bk1.json'); fs.writeFileSync(oldFile, JSON.stringify(old));
  await page.click('[data-tab=ajustes]'); await page.setInputFiles('#filePicker', oldFile);
  await page.waitForSelector('.dlg'); await page.click('[data-ok]'); await page.waitForTimeout(300);
  await page.click('[data-tab=crono]'); assert.doesNotMatch(await text(), /Parque/);

  await page.emulateMedia({ colorScheme: 'dark' }); await shot('f2-4-dark');
  console.log('erros de console/página:', errors.length ? errors : 'nenhum');
  assert.equal(errors.length, 0);
  console.log('E2E FASE 2 OK');
  await browser.close(); server.close();
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
