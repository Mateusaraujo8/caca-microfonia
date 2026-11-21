/* Caça-Microfonia — aba "Planta": desenho da igreja de lado (com galeria) e de cima,
   cobertura das caixas, sombra da galeria, cancelamento dos subs e recomendações.
   Eixo x: 0 na borda do palco, positivo em direção ao fundo. Medidas em metros. */
"use strict";
(() => {
const { $, num } = window.CM;
const EAR = 1.2, ROW = 0.95, C_SOM = 343, D2R = Math.PI / 180;

const FIELDS = [
  ["igreja", "L", "Frente do palco até a parede do fundo (m)", 20, 0.5],
  ["igreja", "W", "Largura da nave (m)", 12, 0.5],
  ["igreja", "Hc", "Altura do teto (m)", 7, 0.1],
  ["igreja", "Ps", "Profundidade do palco (m)", 4, 0.5],
  ["igreja", "Hs", "Altura do palco (m)", 0.6, 0.1],
  ["igreja", "D1", "Frente do palco até a 1ª fileira (m)", 2, 0.5],
  ["igreja", "Mic", "Microfones: quanto ficam atrás da borda do palco (m)", 1.5, 0.5],
  ["galeria", "Hg", "Altura do piso da galeria (m)", 3.2, 0.1],
  ["galeria", "Dg", "Quanto a galeria avança: do fundo até a mureta (m)", 6, 0.5],
  ["galeria", "Mur", "Altura da mureta (m)", 1, 0.1],
  ["galeria", "Gl", "Galeria nas laterais: quanto ela entra na nave, a partir da parede (m). 0 = não tem", 0, 0.5],
  ["galeria", "Lg", "Galeria nas laterais: comprimento, a partir do fundo (m)", 8, 0.5],
  ["caixas", "Sx", "Quanto a caixa fica à frente da borda do palco (m). Negativo = em cima do palco", 0.3, 0.1],
  ["caixas", "Sh", "Altura do centro da caixa, a partir do chão da nave (m)", 3, 0.1],
  ["caixas", "St", "Inclinação para baixo (°)", 5, 1],
  ["caixas", "Sw", "Distância da caixa até a parede lateral (m)", 1.5, 0.1],
  ["caixas", "Toe", "Virada para o centro (°)", 10, 1],
  ["caixas", "CovH", "Cobertura horizontal da caixa (°)", 90, 5],
  ["caixas", "CovV", "Cobertura vertical da caixa (°)", 50, 5]
];
const DEF = { ...Object.fromEntries(FIELDS.map(f => [f[1], f[3]])), Gs: 0 };   // Gs: 0 = galeria lateral nos dois lados, 1 = só esquerdo, 2 = só direito (de quem olha para o palco)

/* ---------- campos ---------- */
for (const [grp, id, label, , step] of FIELDS) {
  const l = document.createElement("label");
  l.className = "fld"; l.htmlFor = "p_" + id;
  l.innerHTML = `<span></span><input type="number" id="p_${id}" step="${step}">`;
  l.firstChild.textContent = label;
  $("#plF_" + grp).append(l);
}
let state = { v: { ...DEF }, gal: true, sub: "lados", f: 63, edited: false, view: "side", fills: false, meas: [], showMeas: false };
let pick = null, topGeom = null;   // ponto escolhido na planta para medir; geometria do desenho de cima
try { const s = JSON.parse(localStorage.getItem("cm_planta") || "null"); if (s && s.v) state = { ...state, ...s, v: { ...DEF, ...s.v } }; } catch (e) {}
const save = () => { try { localStorage.setItem("cm_planta", JSON.stringify(state)); } catch (e) {} };

function fillForm() {
  for (const [, id] of FIELDS) $("#p_" + id).value = state.v[id];
  $("#pGal").checked = state.gal; $("#pSub").value = state.sub; $("#pGs").value = String(state.v.Gs | 0); $("#plFill").checked = !!state.fills;
  $("#pSubF").value = state.f; $("#oSubF").textContent = state.f + " Hz";
  $("#plExample").hidden = state.edited;
  document.querySelectorAll("#viewPl .segb").forEach(b => b.classList.toggle("on", b.dataset.pv === state.view));
}
function readForm() {
  for (const [, id] of FIELDS) { const v = parseFloat($("#p_" + id).value); if (isFinite(v)) state.v[id] = v; }
  state.gal = $("#pGal").checked; state.sub = $("#pSub").value; state.v.Gs = +$("#pGs").value;
}
$("#viewPl").addEventListener("input", e => {
  if (e.target.id === "pSubF") { state.f = +e.target.value; $("#oSubF").textContent = state.f + " Hz"; }
  else { readForm(); state.edited = true; $("#plExample").hidden = true; }
  save(); draw();
});
$("#viewPl").addEventListener("change", e => { if (e.target.id === "plFill") { state.fills = e.target.checked; save(); draw(); return; } if (e.target.id === "pGal" || e.target.id === "pSub") { readForm(); state.edited = true; $("#plExample").hidden = true; save(); draw(); } });
document.querySelectorAll("#viewPl .segb").forEach(b => b.addEventListener("click", () => { state.view = b.dataset.pv; fillForm(); save(); draw(); }));
$("#plSvgBox").addEventListener("click", e => {
  const svg = $("#plSvgBox svg");
  if (!svg || !topGeom || state.view !== "top") return;
  const r = svg.getBoundingClientRect(), P = geo();
  const x = (e.clientX - r.left) / r.width * topGeom.vw / topGeom.K + topGeom.x0, y = (e.clientY - r.top) / r.height * topGeom.vh / topGeom.K - 1.2;
  if (x < 0 || x > P.L || y < 0 || y > P.W) return;
  pick = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  draw(); window.CM.onPick && window.CM.onPick(pick);
});
$("#plReset").addEventListener("click", () => { state = { v: { ...DEF }, gal: true, sub: "lados", f: 63, edited: false, view: state.view, fills: false, meas: state.meas, showMeas: state.showMeas }; $("#plOptMsg").hidden = true; fillForm(); save(); draw(); });

/* ---------- geometria e som ---------- */
function geo() {
  const v = state.v, P = {};
  P.L = Math.max(4, v.L); P.W = Math.max(3, v.W); P.Hc = Math.max(2.5, v.Hc);
  P.Ps = Math.max(0, v.Ps); P.Hs = Math.max(0, Math.min(2, v.Hs));
  P.D1 = Math.max(0.5, Math.min(P.L - 1, v.D1)); P.Mic = v.Mic;
  P.gal = state.gal;
  P.Hg = Math.max(2, Math.min(P.Hc - 1.5, v.Hg));
  P.Dg = Math.max(1, Math.min(P.L - P.D1 - 1, v.Dg));
  P.Mur = Math.max(0.3, Math.min(1.5, v.Mur));
  P.Sx = Math.max(-P.Ps, Math.min(P.L - 2, v.Sx));
  P.Sh = Math.max(0.5, Math.min(P.Hc - 0.2, v.Sh));
  P.St = v.St; P.Sw = Math.max(0.2, Math.min(P.W / 2 - 0.3, v.Sw));
  P.Toe = v.Toe; P.CovH = Math.max(20, Math.min(180, v.CovH)); P.CovV = Math.max(10, Math.min(180, v.CovV));
  P.xm = P.L - P.Dg; // x da mureta
  P.Gl = P.gal ? Math.max(0, Math.min(P.W / 2 - 1, v.Gl)) : 0;          // galeria lateral: profundidade
  P.Lg = Math.max(1, Math.min(P.L - P.D1 - 1, v.Lg));                    // e comprimento a partir do fundo
  P.xs = P.L - P.Lg;                                                     // onde ela começa, vista do palco
  P.Gs = v.Gs | 0;
  return P;
}
// perda fora do eixo: -6 dB na borda da cobertura, cai mais rápido depois
function offAtt(a, cov) {
  const h = cov / 2, x = Math.abs(a);
  return x <= h ? -6 * (x / h) ** 2 : Math.max(-30, -6 - 12 * (x - h) / h);
}
// a linha da caixa até o ouvido passa pela galeria?
function blocked(P, xe, ye) {
  if (!P.gal || xe <= P.xm || P.Sx >= P.xm) return false;
  const y = P.Sh + (ye - P.Sh) * (P.xm - P.Sx) / (xe - P.Sx);
  return ye < P.Hg ? y > P.Hg - 0.3 : y < P.Hg + P.Mur;
}
// nível relativo no corte (eixo central da igreja, uma caixa)
function sideLevel(P, xe, ye) {
  const dx = xe - P.Sx, dy = P.Sh - ye, r = Math.max(0.5, Math.hypot(dx, dy));
  const dep = Math.atan2(dy, dx) / D2R;
  const b = blocked(P, xe, ye);
  return { L: -20 * Math.log10(r) + offAtt(dep - P.St, P.CovV) - (b ? 10 : 0), b };
}
const speakers = P => [
  { x: P.Sx, y: P.Sw, ax: P.Toe },
  { x: P.Sx, y: P.W - P.Sw, ax: -P.Toe }
];
// nível relativo visto de cima (soma das duas caixas, ouvido sentado no piso)
// quem senta embaixo da galeria lateral: o raio da caixa até o ouvido bate no piso da galeria?
// de quem olha para o palco, o lado esquerdo é a parte de baixo do desenho (y grande)
const latSides = P => [...(P.Gs !== 1 ? [[0, P.Gl]] : []), ...(P.Gs !== 2 ? [[P.W - P.Gl, P.W]] : [])];
const underLat = (P, x, y) => P.Gl > 0 && x > P.xs && ((y < P.Gl && P.Gs !== 1) || (y > P.W - P.Gl && P.Gs !== 2));
function sideBlocked(P, s, x, y) {
  if (P.Gl <= 0 || x <= P.xs) return false;
  const plane = y < P.Gl && P.Gs !== 1 ? P.Gl : y > P.W - P.Gl && P.Gs !== 2 ? P.W - P.Gl : null;
  if (plane === null || Math.abs(y - s.y) < 1e-6) return false;
  const t = (plane - s.y) / (y - s.y);
  if (t <= 0 || t >= 1) return false;
  return s.x + t * (x - s.x) >= P.xs && P.Sh + t * (EAR - P.Sh) > P.Hg - 0.3;
}
function topLevel(P, x, y, fills) {
  let p = 0;
  const back = blocked(P, x, EAR);
  for (const s of speakers(P)) {
    const dx = x - s.x, dy = y - s.y, hz = Math.hypot(dx, dy);
    if (dx <= 0.05) continue;
    const az = Math.atan2(dy, dx) / D2R, dep = Math.atan2(P.Sh - EAR, hz) / D2R;
    const r = Math.max(0.5, Math.hypot(hz, P.Sh - EAR));
    const L = -20 * Math.log10(r) + offAtt(az - s.ax, P.CovH) + offAtt(dep - P.St, P.CovV);
    p += Math.pow(10, L / 10) * (back || sideBlocked(P, s, x, y) ? 0.1 : 1);
  }
  // caixas de reforço: apontam para o fundo, ajustadas para igualar o volume da principal naquele ponto
  for (const f of fills || []) {
    const dx = x - f.x, dy = y - f.y, hz = Math.hypot(dx, dy);
    const r = Math.max(0.7, Math.hypot(hz, f.h - EAR));
    p += Math.pow(10, (-20 * Math.log10(r) - 18 + offAtt(Math.atan2(dy, dx) / D2R, 120)) / 10);
  }
  return p > 0 ? 10 * Math.log10(p) : -60;
}

/* ---------- zonas sem som e caixas de reforço ---------- */
const STEP = 0.5;
function weakZones(P) {
  const nx = Math.floor((P.L - P.D1) / STEP), ny = Math.floor(P.W / STEP);
  if (nx < 2 || ny < 2) return { zones: [], M: 0 };
  const lv = [];
  for (let i = 0; i < nx; i++) { lv.push([]); for (let j = 0; j < ny; j++) lv[i].push(topLevel(P, P.D1 + STEP * (i + 0.5), STEP * (j + 0.5))); }
  const M = median(lv.flat());
  const weak = lv.map(r => r.map(v => v - M < -6));
  const seen = lv.map(r => r.map(() => false)), zones = [];
  for (let i0 = 0; i0 < nx; i0++) for (let j0 = 0; j0 < ny; j0++) {
    if (!weak[i0][j0] || seen[i0][j0]) continue;
    const q = [[i0, j0]], cs = [];
    seen[i0][j0] = true;
    while (q.length) {
      const [i, j] = q.pop(); cs.push([i, j]);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && weak[ii][jj] && !seen[ii][jj]) { seen[ii][jj] = true; q.push([ii, jj]); }
      }
    }
    if (cs.length < 6) continue; // menos de 1,5 m²: não vale uma caixa
    const xs = cs.map(c => P.D1 + STEP * c[0]), ys = cs.map(c => STEP * c[1]);
    const z = { area: cs.length * STEP * STEP, x0: Math.min(...xs), x1: Math.max(...xs) + STEP, y0: Math.min(...ys), y1: Math.max(...ys) + STEP, fills: [] };
    const n = Math.max(1, Math.round((z.y1 - z.y0) / 4)), span = (z.y1 - z.y0) / n;
    const nfx = Math.max(1, Math.round((z.x1 - z.x0) / 6)), sx = (z.x1 - z.x0) / nfx;
    const underG = P.gal && (z.x0 >= P.xm - 0.6 || (P.Gl > 0 && z.x0 >= P.xs - 0.6 && ((P.Gs !== 1 && z.y1 <= P.Gl + 0.5) || (P.Gs !== 2 && z.y0 >= P.W - P.Gl - 0.5))));
    const h = underG ? P.Hg - 0.5 : 2.5;
    for (let j = 0; j < nfx; j++) for (let k = 0; k < n; k++) {
      const f = { x: z.x0 + 0.4 + j * sx, y: z.y0 + span * (k + 0.5), h };
      const d = Math.min(...speakers(P).map(sp => Math.hypot(f.x - sp.x, f.y - sp.y, P.Sh - h)));
      f.ms = Math.round(d / C_SOM * 1000 + 8);
      z.fills.push(f);
    }
    zones.push(z);
  }
  zones.sort((a, b) => b.area - a.area);
  return { zones, M };
}
const sideName = (z, W) => { const c = (z.y0 + z.y1) / 2; return z.y1 - z.y0 > W * 0.7 ? "na largura toda" : c < W * 0.35 ? "do lado de cima do desenho" : c > W * 0.65 ? "do lado de baixo do desenho" : "no meio"; };

/* ---------- sugestão de posição das caixas ---------- */
function scorePlan(v, fast) {   // fast: malha mais grossa, só para a busca; o resultado final é medido na malha fina
  const keep = state.v, sp = fast ? 1.1 : 0.7, sl = fast ? 1 : 0.5;
  state.v = { ...keep, ...v };
  try {
    const P = geo(), xEnd = P.gal ? P.xm : P.L;
    const lv = [];
    for (let x = P.D1 + 0.4; x < xEnd; x += sp) for (let y = 0.4; y < P.W; y += sp) { if (underLat(P, x, y)) continue; lv.push(topLevel(P, x, y)); }
    const M = median(lv);
    const inBand = lv.filter(l => Math.abs(l - M) <= 6).length / Math.max(1, lv.length);
    let last = P.D1;
    for (let x = P.D1; x <= P.L - 0.5; x += sl) if (!blocked(P, x, EAR)) last = x;
    const diff = sideLevel(P, P.D1, EAR).L - sideLevel(P, last, EAR).L;
    let galIn = 1;
    if (P.gal) {
      const pts = [];
      for (let x = P.xm + 0.6; x <= P.L - 0.4; x += sl) pts.push(x);
      const ok = pts.filter(x => !blocked(P, x, P.Hg + EAR) && offAtt(Math.atan2(P.Sh - P.Hg - EAR, x - P.Sx) / D2R - P.St, P.CovV) > -9).length;
      galIn = pts.length ? ok / pts.length : 1;
    }
    const gap = P.Sx + P.Mic;
    const sd = Math.sqrt(lv.reduce((t, l) => t + (l - M) ** 2, 0) / Math.max(1, lv.length)); // desempata: quanto mais parelho, melhor
    const score = inBand * 100 - sd * 3 - Math.max(0, diff - 6) * 4 - Math.abs(diff) * 0.5 + galIn * 15 - Math.max(0, 1.5 - gap) * 60;
    return { score, inBand, diff, galIn };
  } finally { state.v = keep; }
}
/* Busca por "descida de coordenadas": ajusta um parâmetro por vez (varre os valores dele e fica com o melhor),
   repete até não melhorar, a partir de alguns pontos de partida diferentes. Cerca de 10x menos contas que testar todas
   as combinações, devolve a tela entre as contas (barra de progresso) e para sozinha se passar do tempo. */
const tick = () => new Promise(r => setTimeout(r, 0));
async function optimize(onProgress) {
  const Pn = geo(), t0 = performance.now(), BUDGET = 4000;
  const sxMin = Math.max(-Pn.Ps, 1.5 - Pn.Mic);
  const range = (a, b, st) => { const r = []; for (let x = a; x <= b + 1e-9; x += st) r.push(+x.toFixed(2)); return r; };
  const dom = {
    Sh: range(2.4, Math.max(2.4, Math.min(Pn.Hc - 0.5, 5.5)), 0.5),
    St: range(0, 28, 3),
    Toe: range(0, 30, 5),
    Sw: range(1, Math.max(1, Math.min(Pn.W / 2 - 0.5, 4.5)), 0.75),
    Sx: [sxMin, sxMin + 0.5, sxMin + 1]
  };
  const clamp = (k, v) => dom[k].reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
  const mid = k => dom[k][Math.floor(dom[k].length / 2)];
  const cur0 = Object.fromEntries(Object.keys(dom).map(k => [k, clamp(k, state.v[k])]));
  const starts = [cur0, { Sh: mid("Sh"), St: 6, Toe: 9, Sw: clamp("Sw", 1.5), Sx: sxMin }, { Sh: dom.Sh[dom.Sh.length - 1], St: 14, Toe: 18, Sw: clamp("Sw", 3), Sx: sxMin + 0.5 }, { Sh: dom.Sh[1] || dom.Sh[0], St: 2, Toe: 3, Sw: clamp("Sw", 2.5), Sx: sxMin }];
  const perRound = Object.values(dom).reduce((a, d) => a + d.length, 0), total = starts.length * 2 * perRound;
  let evals = 0, best = null, last = performance.now();
  const ev = async c => {
    const r = scorePlan(c, true); evals++;
    const now = performance.now();
    if (now - last > 40) { last = now; onProgress && onProgress(Math.min(0.99, evals / total)); await tick(); }
    return r;
  };
  for (const st of starts) {
    let cur = { ...st }, cs = (await ev(cur));
    for (let round = 0; round < 2; round++) {
      let improved = false;
      for (const k of Object.keys(dom)) for (const val of dom[k]) {
        if (val === cur[k]) continue;
        const cand = { ...cur, [k]: val }, r = await ev(cand);
        if (r.score > cs.score + 1e-9) { cur = cand; cs = r; improved = true; }
      }
      if (!improved || performance.now() - t0 > BUDGET) break;
    }
    if (!best || cs.score > best.r.score) best = { cand: cur, r: cs };
    if (performance.now() - t0 > BUDGET) break;
  }
  best.r = scorePlan(best.cand);                       // mede o resultado final na malha fina
  return { best, before: scorePlan({}), evals, ms: Math.round(performance.now() - t0), cut: performance.now() - t0 > BUDGET };
}
let optBusy = false;
$("#plOpt").addEventListener("click", async () => {
  if (optBusy) return;
  optBusy = true; $("#plOpt").disabled = true;
  const msg = $("#plOptMsg");
  msg.hidden = false; msg.className = "status"; msg.textContent = "Calculando a melhor posição… 0%";
  await tick();
  try {
    const { best, before, ms, cut } = await optimize(p => { msg.textContent = `Calculando a melhor posição… ${Math.round(p * 100)}%`; });
    Object.assign(state.v, best.cand);
    state.edited = true; state.fills = true;
    fillForm(); save(); draw();
    const c = best.cand, pct = x => Math.round(x * 100) + "%";
    msg.className = "status ok";
    msg.innerHTML = `Posição sugerida aplicada: caixa a <b>${num(c.Sh, 1)} m</b> de altura, inclinada <b>${c.St}°</b>, virada <b>${c.Toe}°</b> para o centro, a <b>${num(c.Sw, 2)} m</b> da parede e <b>${num(c.Sx, 1)} m</b> à frente do palco. Lugares com volume parecido: de <b>${pct(before.inBand)}</b> para <b>${pct(best.r.inBand)}</b>. Os campos abaixo já foram atualizados; mexa neles para testar outra ideia. <small>(calculado em ${num(ms / 1000, 1)} s${cut ? ", parou no limite de tempo" : ""})</small>`;
  } finally { optBusy = false; $("#plOpt").disabled = false; }
});
const subs = P => state.sub === "centro"
  ? [{ x: 0.5, y: P.W / 2 - 0.35 }, { x: 0.5, y: P.W / 2 + 0.35 }]
  : [{ x: 0.5, y: P.Sw }, { x: 0.5, y: P.W - P.Sw }];
function subLevel(P, x, y, f) {
  const k = 2 * Math.PI * f / C_SOM;
  let re = 0, im = 0;
  for (const s of subs(P)) { const r = Math.max(0.5, Math.hypot(x - s.x, y - s.y, EAR)); re += Math.cos(k * r) / r; im -= Math.sin(k * r) / r; }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-9);
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/* ---------- cores ---------- */
const BANDS = [
  { min: 6, color: "var(--trace)", label: "Alto demais (+6 dB ou mais)" },
  { min: -3, color: "var(--ok)", label: "Bom" },
  { min: -6, color: "#9ccf6a", label: "Um pouco mais baixo (até −6 dB)" },
  { min: -10, color: "var(--amber)", label: "Fraco (−6 a −10 dB)" },
  { min: -Infinity, color: "var(--hot)", label: "Muito fraco / abafado" }
];
const colorOf = rel => BANDS.find(b => rel >= b.min).color;
function legend(extra) {
  $("#plLegend").innerHTML = BANDS.map(b => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join("") + (extra || "");
}

/* ---------- desenho de lado ---------- */
function drawSide(P) {
  const K = 30, pad = 1.2, x0 = -P.Ps - pad, x1 = P.L + pad, yTop = P.Hc + 1.2;
  const W = (x1 - x0) * K, H = (yTop + 1.4) * K, fs = Math.max(13, W / 52);
  const X = x => ((x - x0) * K).toFixed(1), Y = y => ((yTop - y) * K).toFixed(1);
  const T = (x, y, t, anchor = "start", st = "") => `<text x="${X(x)}" y="${Y(y)}" text-anchor="${anchor}" style="fill:var(--mute);font:600 ${fs}px var(--f-mono);${st}">${t}</text>`;
  let s = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Igreja vista de lado">`;
  s += `<defs><clipPath id="room"><rect x="${X(-P.Ps)}" y="${Y(P.Hc)}" width="${(P.Ps + P.L) * K}" height="${P.Hc * K}"/></clipPath></defs>`;
  // sala
  s += `<rect x="${X(-P.Ps)}" y="${Y(P.Hc)}" width="${(P.Ps + P.L) * K}" height="${P.Hc * K}" style="fill:#12171a;stroke:var(--line);stroke-width:2"/>`;
  s += `<rect x="${X(-P.Ps)}" y="${Y(P.Hs)}" width="${P.Ps * K}" height="${P.Hs * K}" style="fill:#2a3238"/>`;
  // cobertura vertical da caixa
  const R = P.L + P.Ps + 5, a1 = (P.St - P.CovV / 2) * D2R, a2 = (P.St + P.CovV / 2) * D2R;
  const px = (a, r) => [P.Sx + Math.cos(a) * r, P.Sh - Math.sin(a) * r];
  const [ax1, ay1] = px(a1, R), [ax2, ay2] = px(a2, R), [cx, cy] = px(P.St * D2R, R);
  s += `<g clip-path="url(#room)"><polygon points="${X(P.Sx)},${Y(P.Sh)} ${X(ax1)},${Y(ay1)} ${X(ax2)},${Y(ay2)}" style="fill:rgba(242,181,68,.10);stroke:rgba(242,181,68,.35)"/>`;
  s += `<line x1="${X(P.Sx)}" y1="${Y(P.Sh)}" x2="${X(cx)}" y2="${Y(cy)}" style="stroke:var(--amber);stroke-width:1.5;stroke-dasharray:6 6"/></g>`;
  // galeria
  if (P.gal) {
    s += `<rect x="${X(P.xm)}" y="${Y(P.Hg)}" width="${P.Dg * K}" height="${0.3 * K}" style="fill:#3a444b"/>`;
    s += `<rect x="${X(P.xm)}" y="${Y(P.Hg + P.Mur)}" width="${0.15 * K}" height="${P.Mur * K}" style="fill:#4a565e"/>`;
    s += T(P.xm + 0.3, P.Hg + P.Mur + 0.25, "galeria " + num(P.Hg, 1) + " m");
  }
  // público: linha do ouvido colorida
  const pts = [];
  for (let x = P.D1; x <= P.L - 0.4; x += 0.25) pts.push({ x, y: EAR, ...sideLevel(P, x, EAR) });
  if (P.gal) for (let x = P.xm + 0.6; x <= P.L - 0.4; x += 0.25) pts.push({ x, y: P.Hg + EAR, ...sideLevel(P, x, P.Hg + EAR) });
  const M = median(pts.map(p => p.L));
  for (const p of pts) s += `<line x1="${X(p.x - 0.13)}" y1="${Y(p.y)}" x2="${X(p.x + 0.13)}" y2="${Y(p.y)}" style="stroke:${colorOf(p.L - M)};stroke-width:${0.32 * K}"/>`;
  // sombra da galeria
  const sh = pts.filter(p => p.b && p.y < P.Hg);
  if (sh.length) {
    const xa = sh[0].x;
    s += `<line x1="${X(P.Sx)}" y1="${Y(P.Sh)}" x2="${X(xa)}" y2="${Y(EAR)}" style="stroke:var(--hot);stroke-width:1.5;stroke-dasharray:3 5"/>`;
    s += T((xa + P.L) / 2, EAR + 0.55, "sombra", "middle", "fill:var(--hot);font-weight:700");
  }
  // microfone e caixa
  const my = P.Hs + 1.5;
  s += `<line x1="${X(-P.Mic)}" y1="${Y(P.Hs)}" x2="${X(-P.Mic)}" y2="${Y(my)}" style="stroke:var(--mute);stroke-width:2"/><circle cx="${X(-P.Mic)}" cy="${Y(my)}" r="${0.14 * K}" style="fill:var(--fg)"/>`;
  s += T(-P.Mic, my + 0.35, "mic", "middle");
  s += `<g transform="translate(${X(P.Sx)} ${Y(P.Sh)}) rotate(${P.St})"><rect x="${-0.2 * K}" y="${-0.33 * K}" width="${0.4 * K}" height="${0.66 * K}" rx="3" style="fill:var(--amber)"/></g>`;
  s += T(P.Sx, P.Sh + 0.65, "caixa", "middle", "fill:var(--amber);font-weight:700");
  // cotas
  s += T(-P.Ps / 2, -0.75, "palco", "middle");
  s += T(P.L / 2, -0.75, num(P.L, 1) + " m até o fundo", "middle");
  s += T(P.L - 0.2, P.Hc - 0.5, "teto " + num(P.Hc, 1) + " m", "end");
  s += "</svg>";
  $("#plSvgBox").innerHTML = s;
  legend(`<span><i style="background:rgba(242,181,68,.35)"></i>Faixa que a caixa cobre</span>`);
  return { pts, M };
}

/* ---------- desenhos de cima ---------- */
function drawTop(P, mode) {
  const K = 26, pad = 1, x0 = -P.Ps - pad, x1 = P.L + pad, W = (x1 - x0) * K, H = (P.W + 2.4) * K, fs = Math.max(13, W / 52);
  const X = x => ((x - x0) * K).toFixed(1), Y = y => ((y + 1.2) * K).toFixed(1);
  topGeom = { x0, K, vw: W, vh: H };
  let s = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Igreja vista de cima">`;
  s += `<rect x="${X(-P.Ps)}" y="${Y(0)}" width="${(P.Ps + P.L) * K}" height="${P.W * K}" style="fill:#12171a;stroke:var(--line);stroke-width:2"/>`;
  s += `<rect x="${X(-P.Ps)}" y="${Y(0)}" width="${P.Ps * K}" height="${P.W * K}" style="fill:#2a3238"/>`;
  // mapa de calor
  const step = 0.5, cells = [];
  const wz = mode === "sub" ? { zones: [] } : weakZones(P);
  const fills = state.fills ? wz.zones.flatMap(z => z.fills) : null;
  const useMeas = mode === "top" && state.showMeas && state.meas.length >= 3;
  const idw = (x, y) => { let sw = 0, sl = 0; for (const m of state.meas) { const w = 1 / ((x - m.x) ** 2 + (y - m.y) ** 2 + 1); sw += w; sl += w * m.L; } return sl / sw; };
  for (let x = P.D1 + step / 2; x < P.L; x += step) for (let y = step / 2; y < P.W; y += step)
    cells.push({ x, y, L: useMeas ? idw(x, y) : mode === "sub" ? subLevel(P, x, y, state.f) : topLevel(P, x, y, fills) });
  const M = useMeas ? median(state.meas.map(m => m.L)) : mode === "sub" ? median(cells.map(c => c.L)) : wz.M; // mesma régua com e sem reforço, para ver a melhora
  for (const c of cells) s += `<rect x="${X(c.x - step / 2)}" y="${Y(c.y - step / 2)}" width="${step * K + 0.6}" height="${step * K + 0.6}" style="fill:${colorOf(c.L - M)};opacity:.82"/>`;
  if (P.gal) {
    s += `<rect x="${X(P.xm)}" y="${Y(0)}" width="${P.Dg * K}" height="${P.W * K}" style="fill:none;stroke:var(--fg);stroke-width:2;stroke-dasharray:8 6"/>`;
    s += `<text x="${X(P.xm + P.Dg / 2)}" y="${Y(-0.35)}" text-anchor="middle" style="fill:var(--mute);font:600 ${fs}px var(--f-mono)">embaixo da galeria</text>`;
  }
  if (P.gal && P.Gl > 0) {
    for (const [ya, yb] of latSides(P)) {
      s += `<rect x="${X(P.xs)}" y="${Y(ya)}" width="${P.Lg * K}" height="${(yb - ya) * K}" style="fill:none;stroke:var(--fg);stroke-width:2;stroke-dasharray:8 6"/>`;
      s += `<text x="${X(P.xs + P.Lg / 2)}" y="${(+Y((ya + yb) / 2) + fs / 3).toFixed(1)}" text-anchor="middle" style="fill:var(--mute);font:600 ${fs}px var(--f-mono)">galeria</text>`;
    }
  }
  if (mode === "sub") {
    for (const b of subs(P)) s += `<rect x="${X(b.x - 0.3)}" y="${Y(b.y - 0.3)}" width="${0.6 * K}" height="${0.6 * K}" style="fill:var(--fg);stroke:#000"/>`;
    s += `<text x="${X(0.5)}" y="${Y(P.W + 0.85)}" style="fill:var(--fg);font:700 ${fs}px var(--f-mono)">■ subs · ${state.f} Hz</text>`;
  } else {
    for (const sp of speakers(P)) {
      const r = Math.min(P.L, 7), a = sp.ax * D2R, h = P.CovH / 2 * D2R;
      const p1 = [sp.x + Math.cos(a - h) * r, sp.y + Math.sin(a - h) * r], p2 = [sp.x + Math.cos(a + h) * r, sp.y + Math.sin(a + h) * r];
      s += `<polyline points="${X(p1[0])},${Y(p1[1])} ${X(sp.x)},${Y(sp.y)} ${X(p2[0])},${Y(p2[1])}" style="fill:none;stroke:var(--fg);stroke-width:1.5;stroke-dasharray:5 5;opacity:.7"/>`;
      s += `<g transform="translate(${X(sp.x)} ${Y(sp.y)}) rotate(${sp.ax})"><rect x="${-0.25 * K}" y="${-0.3 * K}" width="${0.5 * K}" height="${0.6 * K}" rx="3" style="fill:var(--amber)"/></g>`;
    }
  }
  if (mode !== "sub") {
    wz.zones.forEach((z, zi) => {
      if (!state.fills) {
        s += `<rect x="${X(z.x0)}" y="${Y(z.y0)}" width="${(z.x1 - z.x0) * K}" height="${(z.y1 - z.y0) * K}" style="fill:none;stroke:var(--hot);stroke-width:2;stroke-dasharray:4 4"/>`;
        s += `<text x="${X((z.x0 + z.x1) / 2)}" y="${(+Y((z.y0 + z.y1) / 2) + fs / 3).toFixed(1)}" text-anchor="middle" style="fill:#fff;font:700 ${fs}px var(--f-mono);paint-order:stroke;stroke:#000;stroke-width:3px">falta som</text>`;
      }
      for (const f of z.fills) {
        s += `<circle cx="${X(f.x)}" cy="${Y(f.y)}" r="${0.28 * K}" style="fill:var(--trace);stroke:#000;stroke-width:1.5"/>`;
        s += `<text x="${X(f.x + 0.45)}" y="${(+Y(f.y) + fs / 3).toFixed(1)}" style="fill:var(--trace);font:700 ${fs}px var(--f-mono);paint-order:stroke;stroke:#000;stroke-width:3px">reforço · ${f.ms} ms</text>`;
      }
    });
  }
  s += `<line x1="${X(-P.Mic)}" y1="${Y(P.W * 0.3)}" x2="${X(-P.Mic)}" y2="${Y(P.W * 0.7)}" style="stroke:var(--fg);stroke-width:2;stroke-dasharray:2 6"/>`;
  if (mode === "top") {
    const med = state.meas.length ? median(state.meas.map(m => m.L)) : 0;
    state.meas.forEach(m => {
      s += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${0.32 * K}" style="fill:#000;stroke:#fff;stroke-width:2"/>`;
      s += `<text x="${X(m.x)}" y="${(+Y(m.y) + fs / 3).toFixed(1)}" text-anchor="middle" style="fill:#fff;font:700 ${fs * 0.8}px var(--f-mono)">${m.L - med >= 0 ? "+" : "−"}${Math.abs(Math.round(m.L - med))}</text>`;
    });
    if (pick) s += `<g style="stroke:var(--trace);stroke-width:3;fill:none"><circle cx="${X(pick.x)}" cy="${Y(pick.y)}" r="${0.5 * K}"/><line x1="${X(pick.x) - 0.8 * K}" y1="${Y(pick.y)}" x2="${+X(pick.x) + 0.8 * K}" y2="${Y(pick.y)}"/><line x1="${X(pick.x)}" y1="${Y(pick.y) - 0.8 * K}" x2="${X(pick.x)}" y2="${+Y(pick.y) + 0.8 * K}"/></g>`;
  }
  s += `<text x="${X(-P.Ps / 2)}" y="${Y(P.W + 0.85)}" text-anchor="middle" style="fill:var(--mute);font:600 ${fs}px var(--f-mono)">palco</text>`;
  s += `<text x="${X(P.L)}" y="${Y(P.W + 0.85)}" text-anchor="end" style="fill:var(--mute);font:600 ${fs}px var(--f-mono)">fundo · ${num(P.W, 1)} m de largura</text>`;
  s += "</svg>";
  $("#plSvgBox").innerHTML = s;
  legend(mode === "sub" ? `<span><i style="background:var(--fg)"></i>Subs</span>` : `<span><i style="background:var(--amber)"></i>Caixas (tracejado: cobertura)</span><span><i style="background:var(--trace);border-radius:50%"></i>Caixa de reforço sugerida (com delay)</span><span>Contorno vermelho: falta som</span><span>Linha pontilhada: microfones</span>` + (useMeas ? `<span><b>Cores = som MEDIDO</b> em ${state.meas.length} pontos (número = dB acima ou abaixo da média)</span>` : ""));
  return { cells, M };
}

/* ---------- recomendações ---------- */
function recommend(P) {
  const R = [];
  const add = (lvl, html) => R.push({ lvl, html });

  // 1. caixas à frente dos microfones
  const gap = P.Sx + P.Mic;
  if (gap < 0.5) add("bad", `As caixas estão na linha dos microfones ou atrás deles. Isso puxa microfonia. Coloque as caixas <b>pelo menos 1,5 m à frente</b> dos microfones.`);
  else if (gap < 1.5) add("warn", `As caixas ficam só <b>${num(gap, 1)} m</b> à frente dos microfones. Se der, adiante as caixas ou recue os microfones para ter pelo menos 1,5 m.`);
  else add("ok", `Caixas <b>${num(gap, 1)} m</b> à frente dos microfones. Bom contra microfonia.`);

  // 2. inclinação para o piso
  const backFloor = P.gal ? P.L - 0.5 : P.L - 0.5;
  const xt = P.D1 + 0.7 * (backFloor - P.D1);
  const ideal = Math.atan2(P.Sh - EAR, xt - P.Sx) / D2R;
  const front = sideLevel(P, P.D1, EAR).L;
  let lastClear = P.D1;
  for (let x = P.D1; x <= backFloor; x += 0.25) if (!blocked(P, x, EAR)) lastClear = x;
  const back = sideLevel(P, lastClear, EAR).L, diff = front - back;
  if (Math.abs(P.St - ideal) > 4) add("warn", `Inclinação: para o som cair em ~70% da nave, incline as caixas para <b>≈ ${Math.round(ideal)}°</b> para baixo (hoje: ${Math.round(P.St)}°). Confira com o inclinômetro da aba Caixas.`);
  if (diff > 10) add("bad", `A 1ª fileira ouve <b>${Math.round(diff)} dB</b> mais alto que o fundo. A frente vai achar alto demais e o fundo não vai entender. Suba a caixa${P.Sh < 3 ? " (está a " + num(P.Sh, 1) + " m)" : ""} ou use caixa de reforço no meio da igreja.`);
  else if (diff > 6) add("warn", `Diferença de <b>${Math.round(diff)} dB</b> entre a 1ª fileira e o fundo. Aceitável; subir um pouco a caixa ajuda.`);
  else add("ok", `Frente e fundo com volume parecido (diferença de ${Math.round(Math.max(0, diff))} dB).`);

  if (P.gal) {
    // 3. sombra embaixo da galeria
    let xb = null;
    for (let x = P.xm; x <= P.L - 0.4; x += 0.1) if (blocked(P, x, EAR)) { xb = x; break; }
    if (xb !== null) {
      const len = P.L - xb, rows = Math.max(1, Math.round(len / ROW));
      const xf = P.xm + 0.5, hf = P.Hg - 0.5;
      const ms = Math.hypot(xf - P.Sx, hf - P.Sh) / C_SOM * 1000;
      const n = Math.max(2, Math.ceil(P.W / 4));
      add("bad", `As últimas <b>~${rows} fileiras embaixo da galeria</b> (a partir de ${num(xb, 1)} m do palco) não enxergam a caixa: som abafado, voz sem clareza. Solução: <b>${n} caixas pequenas</b> presas embaixo da galeria, perto da mureta, apontando para o fundo, com <b>delay de ≈ ${Math.round(ms + 5)} a ${Math.round(ms + 10)} ms</b>. Baixar a caixa principal diminui a sombra, mas piora a cobertura da galeria e do fundo, por isso o normal é usar as caixas embaixo da galeria.`);
    } else add("ok", `Todas as fileiras embaixo da galeria enxergam a caixa.`);

    // 4. cobertura da galeria
    const yb = P.Hg + EAR;
    const balc = [];
    for (let x = P.xm + 0.6; x <= P.L - 0.4; x += 0.25) balc.push({ x, dep: Math.atan2(P.Sh - yb, x - P.Sx) / D2R, b: blocked(P, x, yb) });
    const top = P.St - P.CovV / 2;
    const outside = balc.filter(p => p.dep < top - 4).length / Math.max(1, balc.length);
    const blockedB = balc.filter(p => p.b).length;
    const a1 = Math.atan2(P.Sh - EAR, P.D1 - P.Sx) / D2R;
    const a3 = Math.min(...balc.map(p => p.dep), Math.atan2(P.Sh - EAR, lastClear - P.Sx) / D2R);
    const need = a1 - a3, mid = (a1 + a3) / 2;
    if (blockedB) add("bad", `A mureta tapa a visão da caixa nas <b>primeiras ~${Math.max(1, Math.round(blockedB * 0.25 / ROW))} fileiras da galeria</b>. Suba a caixa para pelo menos ${num(P.Hg + P.Mur + 0.5, 1)} m ou use uma caixa só para a galeria.`);
    if (outside > 0.3) {
      if (need <= P.CovV) add("warn", `A galeria fica acima da cobertura da caixa. Para cobrir piso e galeria juntos, incline para <b>≈ ${Math.round(mid)}°</b> para baixo: sua caixa cobre ${P.CovV}°, e o necessário é ${Math.round(need)}°.`);
      else add("bad", `A galeria fica fora da cobertura. Piso e galeria precisam de <b>${Math.round(need)}°</b> na vertical e a caixa cobre ${P.CovV}°. Use <b>uma segunda caixa por lado mirando a galeria</b> (ou caixas com mais cobertura vertical) e deixe a principal para o piso.`);
    } else if (!blockedB) add("ok", `A galeria está dentro da cobertura das caixas.`);

    // 5. eco da mureta
    const dm = Math.hypot(P.xm - P.Sx, P.Hg + P.Mur / 2 - P.Sh), dStage = Math.hypot(P.xm + P.Mic, P.Hg + P.Mur / 2 - (P.Hs + 1.6));
    const echo = (dm + dStage) / C_SOM * 1000;
    if (echo > 50) add("warn", `A frente da galeria devolve o som para o palco com <b>~${Math.round(echo)} ms</b> de atraso: dá eco para os músicos e ajuda a microfonia. Cubra a mureta com <b>tecido grosso, carpete ou espuma</b>.`);
  }

  // 6. cobertura horizontal
  const cells = [];
  for (let x = P.D1 + 0.25; x < (P.gal ? P.xm : P.L); x += 0.5) for (let y = 0.25; y < P.W; y += 0.5) cells.push({ x, y, L: topLevel(P, x, y) });
  const M = median(cells.map(c => c.L));
  const good = cells.filter(c => c.L - M >= -6).length / Math.max(1, cells.length);
  const weakSides = cells.filter(c => c.L - M < -6 && (c.y < P.W * 0.2 || c.y > P.W * 0.8) && c.x < P.L / 2).length;
  const weakCenter = cells.filter(c => c.L - M < -6 && Math.abs(c.y - P.W / 2) < P.W * 0.15).length;
  let msg = `<b>${Math.round(good * 100)}%</b> dos lugares no piso ficam com volume bom (até 6 dB abaixo da média).`;
  if (weakSides > cells.length * 0.05) msg += ` As <b>laterais da frente</b> ficam fracas: vire as caixas um pouco menos para o centro.`;
  else if (weakCenter > cells.length * 0.05) msg += ` O <b>meio</b> fica fraco: vire as caixas um pouco mais para o centro.`;
  add(good > 0.85 ? "ok" : good > 0.7 ? "warn" : "bad", msg);

  // 6b. zonas sem som e reforços
  const wz = weakZones(P);
  if (!wz.zones.length) add("ok", `Não há zona grande sem som no piso.`);
  else {
    const area = wz.zones.reduce((a, z) => a + z.area, 0), nf = wz.zones.reduce((a, z) => a + z.fills.length, 0);
    const list = wz.zones.slice(0, 3).map(z => `~${Math.round(z.area)} m² ${sideName(z, P.W)}, a ${num(z.x0, 1)} a ${num(z.x1, 1)} m do palco (${z.fills.length} caixa${z.fills.length > 1 ? "s" : ""}, delay ≈ ${z.fills[0].ms} ms, a ${num(z.fills[0].h, 1)} m de altura)`).join("; ");
    add(area > 40 ? "bad" : "warn", `Falta som em <b>${wz.zones.length} ${wz.zones.length > 1 ? "zonas" : "zona"}</b> (~${Math.round(area)} m² no total). Coloque <b>${nf} caixa${nf > 1 ? "s" : ""} de reforço</b> apontando para o fundo: ${list}. O delay faz o som da principal chegar primeiro e a voz parecer vir do palco. Marque "Ver com as caixas de reforço" para ver o resultado.`);
  }

  // 6c. o que foi medido de verdade
  if (state.meas.length >= 3) {
    const med = median(state.meas.map(m => m.L)), mod = state.meas.map(m => topLevel(P, m.x, m.y)), modMed = median(mod);
    const where = m => `a ${num(m.x, 1)} m do palco e ${num(m.y, 1)} m da borda de cima do desenho`;
    const weak = state.meas.map(m => ({ m, d: m.L - med })).filter(o => o.d < -4).sort((a, b) => a.d - b.d).slice(0, 3);
    if (weak.length) add(weak[0].d < -8 ? "bad" : "warn", `<b>Medido:</b> o som real fica fraco nestes pontos: ${weak.map(o => `${where(o.m)} (${Math.round(o.d)} dB em relação à média)`).join("; ")}. Reforço de caixa ou virar as principais para esses lugares ajuda.`);
    else add("ok", `<b>Medido:</b> nos ${state.meas.length} pontos medidos o volume é parecido (diferença menor que 4 dB).`);
    const err = state.meas.reduce((a, m, i) => a + Math.abs((m.L - med) - (mod[i] - modMed)), 0) / state.meas.length;
    add(err > 4 ? "warn" : "ok", err > 4 ? `O cálculo do app erra em média <b>${Math.round(err)} dB</b> em relação ao que você mediu (a sala tem reflexões que o modelo não conhece). Confie mais nas medições.` : `O cálculo do app bate com o que você mediu (diferença média de ${num(err, 1)} dB).`);
  }

  // 7. subs
  if (state.sub === "lados") {
    const s = P.W - 2 * P.Sw, lam = C_SOM / state.f, D = (P.D1 + P.L) / 2;
    const yNull = Math.min(P.W / 2, (lam / 2) * D / Math.max(0.5, s));
    add("bad", `Com <b>um sub de cada lado</b> (${num(s, 1)} m de distância), o grave cancela em faixas: no meio da igreja, a uns <b>${num(yNull, 1)} m</b> de cada lado do corredor central, o grave de ${state.f} Hz quase some. <b>Junte os subs no centro</b>, na frente do palco. Veja no desenho "De cima · grave".`);
  } else add("ok", `Subs juntos no centro: grave parecido para todo mundo. Confirme o melhor ponto com o "sub crawl": sub no meio da igreja, celular perto do chão nos lugares possíveis.`);

  const order = { bad: 0, warn: 1, ok: 2 };
  R.sort((a, b) => order[a.lvl] - order[b.lvl]);
  const TAG = { bad: "Mudar", warn: "Atenção", ok: "Ok" };
  $("#plRecs").innerHTML = R.map(r => `<li class="${r.lvl}"><span class="tag">${TAG[r.lvl]}</span><span>${r.html}</span></li>`).join("");
  return R;
}

/* ---------- desenhar ---------- */
function draw() {
  if ($("#viewPl").hidden) return;
  window.CM.onDraw && window.CM.onDraw();
  const P = geo();
  $("#plFreqRow").hidden = state.view !== "sub";
  if (state.view === "side") drawSide(P); else drawTop(P, state.view === "sub" ? "sub" : "top");
  recommend(P);
}
window.addEventListener("resize", draw); // a aba chama resize quando aparece
fillForm();
window.CM.setPlan = (id, v) => {
  if (!(id in state.v) || !isFinite(v)) return;
  state.v[id] = Math.round(v * 100) / 100;
  state.edited = true;
  fillForm(); save(); draw();
};
window.CM.setPlanGal = on => { state.gal = !!on; state.edited = true; fillForm(); save(); draw(); };
window.CM.planta = {
  geo, sideLevel, topLevel, subLevel, blocked, state: () => state,
  getPick: () => pick, setPick: p => { pick = p; draw(); },
  addMeas: m => { state.meas.push(m); save(); draw(); },
  delMeas: i => { state.meas.splice(i, 1); save(); draw(); },
  clearMeas: () => { state.meas = []; pick = null; save(); draw(); },
  setShow: on => { state.showMeas = !!on; save(); draw(); },
  setView: v => { state.view = v; fillForm(); save(); draw(); }
};
})();
