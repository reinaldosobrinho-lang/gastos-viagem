// Gráfico da linha do tempo em SVG (sem bibliotecas). Cores e animações vêm do CSS (classes tl-*).
export const COL = 40; // largura de cada dia, em px
const A = { top: 26, h: 190 }; // painel do saldo
const B = { top: A.top + A.h + 24, h: 92 }; // painel planejado × real
const ICO = { top: B.top + B.h + 8 }; // linha de ícones
const XL = { top: ICO.top + 50 }; // rótulos de dia
export const CHART_H = XL.top + 46;
export const AXIS_W = 54;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function niceStep(range, target = 4) {
  const raw = range / target || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
function axisScale(min, max) {
  if (max === min) max = min + 1;
  const step = niceStep(max - min);
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}
const f1 = (n) => Math.round(n * 10) / 10;

/** T = saída de timelineData; label(v) formata centavos de forma compacta. Retorna { axis, plot, width, xOf }. */
export function buildTimelineSvg(T, { label }) {
  const n = T.days.length;
  const W = n * COL;
  const xOf = (i) => (i + 0.5) * COL;

  // ---- painel A: saldo ----
  const vals = [0];
  for (const d of T.days) for (const v of [d.balReal, d.projMin, d.projMax]) if (v !== null) vals.push(v);
  const sa = axisScale(Math.min(...vals), Math.max(...vals));
  const yA = (v) => f1(A.top + ((sa.hi - v) / (sa.hi - sa.lo)) * A.h);
  const ticksA = [];
  for (let v = sa.lo; v <= sa.hi + sa.step / 2; v += sa.step) ticksA.push(v);

  // ---- painel B: planejado × real ----
  const maxB = Math.max(1, ...T.days.map((d) => Math.max(d.planMax, d.realSpent)));
  const sb = axisScale(0, maxB);
  const yB = (v) => f1(B.top + B.h - (v / sb.hi) * B.h);
  const baseB = B.top + B.h;

  const g = [];
  // zona negativa e grade
  if (sa.lo < 0) g.push(`<rect class="tl-neg" x="0" y="${yA(0)}" width="${W}" height="${f1(A.top + A.h - yA(0))}"/>`);
  for (const v of ticksA) g.push(`<line class="${v === 0 ? 'tl-zero' : 'tl-grid'}" x1="0" x2="${W}" y1="${yA(v)}" y2="${yA(v)}"/>`);
  g.push(`<line class="tl-grid" x1="0" x2="${W}" y1="${baseB}" y2="${baseB}"/>`);
  g.push(`<line class="tl-grid" x1="0" x2="${W}" y1="${yB(sb.hi)}" y2="${yB(sb.hi)}"/>`);

  // seleção (movida por JS)
  g.push(`<rect class="tl-sel" id="tlSel" x="0" y="0" width="${COL}" height="${CHART_H}" visibility="hidden"/>`);

  // faixa entre os dois cenários + linhas tracejadas (a partir de hoje, ou do 1º dia se a viagem ainda não começou)
  const proj = T.days.map((d, i) => ({ i, min: d.projMin, max: d.projMax })).filter((p) => p.min !== null);
  if (proj.length) {
    const up = proj.map((p) => `${xOf(p.i)},${yA(p.min)}`);
    const down = [...proj].reverse().map((p) => `${xOf(p.i)},${yA(p.max)}`);
    g.push(`<polygon class="tl-band" points="${[...up, ...down].join(' ')}"/>`);
    g.push(`<polyline class="tl-best" points="${up.join(' ')}"/>`);
    g.push(`<polyline class="tl-worst" points="${proj.map((p) => `${xOf(p.i)},${yA(p.max)}`).join(' ')}"/>`);
  }

  // saldo real (sólido) com área
  const real = T.days.map((d, i) => ({ i, v: d.balReal })).filter((p) => p.v !== null);
  if (real.length) {
    const pts = real.map((p) => `${xOf(p.i)},${yA(p.v)}`);
    const first = real[0];
    const last = real[real.length - 1];
    g.push(`<polygon class="tl-area" points="${xOf(first.i)},${yA(0)} ${pts.join(' ')} ${xOf(last.i)},${yA(0)}"/>`);
    g.push(`<polyline class="tl-line" pathLength="1" points="${pts.join(' ')}"/>`);
  }

  // hoje
  if (T.todayIndex >= 0) {
    const d = T.days[T.todayIndex];
    const x = xOf(T.todayIndex);
    const yv = d.balReal ?? d.projMin ?? 0;
    g.push(`<line class="tl-today" x1="${x}" x2="${x}" y1="${A.top - 6}" y2="${baseB}"/>`);
    g.push(`<rect class="tl-pill" x="${x - 19}" y="2" width="38" height="18" rx="9"/><text class="tl-pilltxt" x="${x}" y="15" text-anchor="middle">Hoje</text>`);
    g.push(`<circle class="tl-pulse-ring" cx="${x}" cy="${yA(yv)}" r="7"/><circle class="tl-pulse" cx="${x}" cy="${yA(yv)}" r="4.5"/>`);
  }

  // barras: planejado (mín sólido, até o máx tracejado) × real
  const bw = COL * 0.64;
  T.days.forEach((d, i) => {
    const x = xOf(i);
    const style = `style="--i:${i}"`;
    if (d.planMax > 0) {
      g.push(`<rect class="tl-bar tl-plan-max" ${style} x="${f1(x - bw / 2)}" y="${yB(d.planMax)}" width="${f1(bw)}" height="${f1(baseB - yB(d.planMax))}" rx="3"/>`);
      if (d.planMin > 0) g.push(`<rect class="tl-bar tl-plan-min" ${style} x="${f1(x - bw / 2)}" y="${yB(d.planMin)}" width="${f1(bw)}" height="${f1(baseB - yB(d.planMin))}" rx="3"/>`);
    }
    if (d.realSpent > 0) {
      const over = d.planMax > 0 && d.realSpent > d.planMax;
      g.push(`<rect class="tl-bar ${over ? 'tl-over' : 'tl-real'}" ${style} x="${f1(x - bw * 0.3)}" y="${yB(d.realSpent)}" width="${f1(bw * 0.6)}" height="${f1(baseB - yB(d.realSpent))}" rx="3"/>`);
    }
  });

  // ícones (até 2; se houver mais, 1 + "+N") e rótulos de dia
  T.days.forEach((d, i) => {
    const x = xOf(i);
    const ic = d.icons;
    // até 4 ícones em 2 colunas; acima disso, 3 ícones + "+N"
    const shown = ic.length <= 4 ? ic : ic.slice(0, 3);
    const pos = (k) => ({ px: ic.length === 1 ? x : x + (k % 2 === 0 ? -10 : 10), py: ICO.top + 17 + Math.floor(k / 2) * 23 });
    shown.forEach((e, k) => { const { px, py } = pos(k); g.push(`<text class="tl-emoji" x="${px}" y="${py}" text-anchor="middle">${e}</text>`); });
    if (ic.length > 4) { const { px, py } = pos(3); g.push(`<text class="tl-more" x="${px}" y="${py - 2}" text-anchor="middle">+${ic.length - 3}</text>`); }
    if (d.unpriced) g.push(`<circle class="tl-unpriced" cx="${x + 12}" cy="${ICO.top + 6}" r="3"/>`);
    g.push(`<text class="tl-wd" x="${x}" y="${XL.top + 6}" text-anchor="middle">${d.weekday}</text>`);
    g.push(`<text class="tl-dn" x="${x}" y="${XL.top + 22}" text-anchor="middle">${d.dayNum}</text>`);
    if (i === 0 || d.dayNum === 1) g.push(`<text class="tl-mo" x="${x}" y="${XL.top + 36}" text-anchor="middle">${MONTHS[d.month - 1]}</text>`);
  });

  // áreas de toque
  T.days.forEach((d, i) => g.push(`<rect class="tl-hit" data-i="${i}" x="${i * COL}" y="0" width="${COL}" height="${CHART_H}"><title>${d.dayNum}/${d.month}</title></rect>`));

  const plot = `<svg class="tl-svg" width="${W}" height="${CHART_H}" viewBox="0 0 ${W} ${CHART_H}" role="img" aria-label="Linha do tempo do saldo e dos gastos por dia">${g.join('')}</svg>`;

  // eixo fixo à esquerda
  const ax = [];
  for (const v of ticksA) ax.push(`<text x="${AXIS_W - 6}" y="${yA(v) + 3}" text-anchor="end">${label(v)}</text>`);
  ax.push(`<text x="${AXIS_W - 6}" y="${baseB + 3}" text-anchor="end">0</text>`);
  ax.push(`<text x="${AXIS_W - 6}" y="${yB(sb.hi) + 3}" text-anchor="end">${label(sb.hi)}</text>`);
  ax.push(`<text class="tl-axis-title" x="${AXIS_W - 6}" y="${A.top - 10}" text-anchor="end">saldo</text>`);
  ax.push(`<text class="tl-axis-title" x="${AXIS_W - 6}" y="${B.top - 8}" text-anchor="end">por dia</text>`);
  const axis = `<svg width="${AXIS_W}" height="${CHART_H}" viewBox="0 0 ${AXIS_W} ${CHART_H}" aria-hidden="true">${ax.join('')}</svg>`;

  return { axis, plot, width: W, xOf };
}
