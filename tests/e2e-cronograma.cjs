// Importação, ícones e linha do tempo no Chromium (iPhone 13 emulado), com dados FICTÍCIOS.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e-cronograma.cjs [pasta-de-screenshots]
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..', 'docs');
const shots = process.argv[2];
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
  const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });
  const text = async () => norm(await page.locator('#app').innerText());
  const closed = () => page.waitForSelector('#sheet[hidden]', { state: 'attached' });

  await page.goto(url); await page.waitForSelector('#setupForm');
  await page.fill('[name=name]', 'Teste'); await page.fill('[name=start]', addDays(-3)); await page.fill('[name=end]', addDays(6));
  await page.fill('[name=p0]', 'Ana'); await page.fill('[name=p1]', 'Bia'); await page.fill('[name=p2]', 'Caio');
  await page.click('#setupForm button[type=submit]'); await page.waitForSelector('#tabs:not([hidden])');
  await page.click('[data-tab=saldo]'); await page.click('[data-act=new-entry]');
  await page.fill('#eAmount', '2000'); await page.fill('#eDate', addDays(-3)); await page.click('#entForm button[type=submit]'); await closed();
  await page.click('[data-tab=gastos]'); await page.click('[data-act=new-expense]');
  await page.fill('#fAmount', '120'); await page.fill('#fDate', addDays(-2)); await page.click('[data-all]'); await page.click('#expForm button[type=submit]'); await closed();

  // ---- importação (arquivo fictício) ----
  const items = [
    { date: addDays(-1), title: 'Parque Alfa', icon: '🎢', notes: 'obs fictícia' },
    { date: addDays(0), title: 'Praia Beta' },
    { date: addDays(0), title: 'Almoço Gama' },
    { date: addDays(2), title: 'Jogo Delta', min: 8000, max: 15000 },
    { date: addDays(9), title: 'Fora do período' },
  ];
  const file = path.join(os.tmpdir(), 'cron-ficticio.json');
  fs.writeFileSync(file, JSON.stringify({ app: 'gastos-viagem', kind: 'cronograma', schema: 1, activities: items }));
  await page.click('[data-tab=crono]');
  await page.setInputFiles('#schedPicker', file);
  await page.waitForSelector('.dlg');
  const dlg = norm(await page.locator('.dlg').innerText());
  assert.match(dlg, /5 atividade/); assert.match(dlg, /fora do período/); assert.match(dlg, /sem valor previsto/);
  await page.click('[data-ok]'); await page.waitForSelector('#tlCard svg');
  // reimportar o mesmo arquivo: tudo é duplicata
  await page.evaluate(() => { document.getElementById('schedPicker').value = ''; });
  await page.setInputFiles('#schedPicker', file); await page.waitForSelector('.dlg');
  assert.match(norm(await page.locator('.dlg').innerText()), /Nada para importar/); await page.click('[data-ok]');
  // arquivo inválido
  const bad = path.join(os.tmpdir(), 'cron-ruim.json'); fs.writeFileSync(bad, JSON.stringify({ app: 'gastos-viagem', kind: 'cronograma', schema: 1, activities: [{ date: '2026-13-01', title: 'x' }] }));
  await page.evaluate(() => { document.getElementById('schedPicker').value = ''; });
  await page.setInputFiles('#schedPicker', bad); await page.waitForSelector('.dlg'); assert.match(await page.locator('.dlg').innerText(), /inválido/); await page.click('[data-ok]');

  // ---- gráfico ----
  const svg = page.locator('#tlCard svg.tl-svg');
  const nDays = await page.locator('#tlCard .tl-hit').count();
  assert.ok(nDays >= 10, 'um bloco por dia (viagem de 10 dias + 1 dia fora do período)');
  assert.ok((await svg.innerHTML()).includes('🎢'), 'ícone da atividade no gráfico');
  assert.ok(await page.locator('#tlCard .tl-line').count() === 1 && await page.locator('#tlCard .tl-pulse').count() === 1);
  assert.equal(await page.locator('#tlCard .tl-anim').count() >= 0, true);
  await shot('c1-grafico');

  // tocar em um dia: painel do dia com atividades e ajustes
  const todayIdx = await page.evaluate(() => [...document.querySelectorAll('#tlCard .tl-hit')].findIndex((r) => document.querySelector('.tl-today') && Math.abs(Number(r.getAttribute('x')) + 20 - Number(document.querySelector('.tl-today').getAttribute('x1'))) < 1));
  assert.ok(todayIdx >= 0);
  await page.locator('#tlCard .tl-hit').nth(todayIdx).click({ force: true });
  let dayTxt = norm(await page.locator('#tlDay').innerText());
  assert.match(dayTxt, /Hoje/); assert.match(dayTxt, /Praia Beta/); assert.match(dayTxt, /Almoço Gama/); assert.match(dayTxt, /Valor a definir/);
  // ajuste rápido: concluir uma atividade a partir do painel do dia
  await page.locator('#tlDay .tl-act', { hasText: 'Praia Beta' }).locator('[data-status=done]').click();
  await page.waitForFunction(() => /Concluída/.test(document.querySelector('#tlDay')?.innerText ?? ''));
  assert.match(norm(await page.locator('#tlDay').innerText()), /Praia Beta[\s\S]*Concluída/);
  // + Gasto neste dia: data já preenchida com o dia tocado
  await page.click('#tlDay [data-act=new-expense]');
  assert.equal(await page.locator('#fDate').inputValue(), addDays(0));
  await page.fill('#fAmount', '30'); await page.click('[data-pid=p1]'); await page.click('#expForm button[type=submit]'); await closed();
  dayTxt = norm(await page.locator('#tlDay').innerText());
  assert.match(dayTxt, /Gasto real no dia\s*US\$ 30,00/);
  // + Atividade neste dia: formulário com ícone sugerido e sem valor
  await page.click('#tlDay [data-act=add-activity]');
  await page.fill('#aTitle', 'Jantar Épsilon');
  assert.equal(await page.locator('#iconBox .chip.on').innerText(), '🍽️'); // sugestão automática
  await page.click('#iconBox [data-icon="🎭"]');
  assert.equal(await page.locator('#iconBox .chip.on').innerText(), '🎭'); // escolha manual vence
  await page.fill('#aMin', '10'); await page.click('[data-all]'); // só mínimo: erro
  await page.click('#actForm button[type=submit]');
  assert.match(await page.locator('#aErr').innerText(), /mínimo e máximo, ou deixe os dois vazios/);
  await page.fill('#aMin', ''); await page.click('[data-mode=custom]'); await page.click('#actForm button[type=submit]');
  assert.match(await page.locator('#aErr').innerText(), /personalizada precisa/);
  await page.click('[data-mode=equal]'); await page.fill('#aNotes', 'obs <b>x</b>'); await page.click('#actForm button[type=submit]'); await closed();
  assert.match(await text(), /Jantar Épsilon/);
  assert.ok((await page.locator('#tlCard svg.tl-svg').innerHTML()).includes('🎭'));
  // alerta de atividades sem valor
  assert.match(await text(), /sem valor previsto/);

  // preencher valor depois: entra na previsão
  await page.locator('.item', { hasText: 'Jantar Épsilon' }).first().click();
  assert.equal(await page.locator('#aNotes').inputValue(), 'obs <b>x</b>');
  await page.fill('#aMin', '20'); await page.fill('#aMax', '60'); await page.click('#actForm button[type=submit]'); await closed();
  assert.match(await text(), /Previsto US\$ 20,00 a US\$ 60,00/);

  // reproduzir (animação) não quebra e termina
  await page.click('[data-act=tl-play]'); await page.waitForTimeout(500);
  assert.ok(await page.locator('#tlScroll.tl-anim').count() === 1);
  await shot('c2-reproduzir');
  await page.waitForTimeout(3600);

  // persistência e backup com ícone/observações
  await page.reload(); await page.waitForSelector('[data-tab=crono]'); await page.click('[data-tab=crono]'); await page.waitForSelector('#tlCard svg');
  assert.match(await text(), /Jantar Épsilon/);
  await page.click('[data-tab=ajustes]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  const bf = path.join(os.tmpdir(), 'bk3.json'); await dl.saveAs(bf);
  const bk = JSON.parse(fs.readFileSync(bf, 'utf8'));
  assert.equal(bk.activities.length, 6);
  assert.ok(bk.activities.some((a) => a.icon === '🎭' && a.notes === 'obs <b>x</b>'));
  assert.ok(bk.activities.some((a) => a.min === null && a.max === null));
  await page.emulateMedia({ colorScheme: 'dark' }); await page.click('[data-tab=crono]'); await page.waitForSelector('#tlCard svg'); await shot('c3-dark');
  console.log('erros de console/página:', errors.length ? errors : 'nenhum');
  assert.equal(errors.length, 0);
  console.log('E2E CRONOGRAMA OK');
  await browser.close(); server.close();
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
