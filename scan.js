/* Caça-Microfonia — "Escanear a igreja com a câmera".
   Câmera ao vivo + sensor de inclinação (giroscópio/acelerômetro), funciona no Android e no iPhone.
   A pessoa fica em pé num ponto, aponta a mira para cada ponto pedido e segura firme: o app marca sozinho
   (média das leituras durante o tempo parado). Cada ponto vira uma direção; o chão vira distância pela altura do celular.
   Referencial: x = leste (relativo), y = norte (relativo), z = para cima. O celular fica em (0, 0, h). */
"use strict";
(() => {
const { $, num, toast } = window.CM;
const D2R = Math.PI / 180;
const EPS = 0.6;            // incerteza típica do sensor de inclinação, em graus
let DWELL = 1300;           // quanto tempo segurar firme, em ms
const STEADY = 0.9;         // quanto a mira pode tremer, em graus

/* ---------- geometria ---------- */
// direção para onde a câmera de trás olha (W3C: R = Rz(alfa) Rx(beta) Ry(gama), câmera = eixo -z do aparelho)
function dirFrom(alpha, beta, gamma) {
  const a = alpha * D2R, b = beta * D2R, g = gamma * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return [-sg * ca - cg * sb * sa, -sg * sa + cg * sb * ca, -cg * cb];
}
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dotv(a, b)))) / D2R;
const elev = d => Math.asin(Math.max(-1, Math.min(1, d[2]))) / D2R;
const hor = d => Math.hypot(d[0], d[1]);
// onde o raio encontra o chão (celular a h metros do chão)
function floorPoint(d, h) {
  if (d[2] > -Math.sin(2.5 * D2R)) return null;
  const t = h / -d[2];
  return { x: d[0] * t, y: d[1] * t };
}
// altura de um alvo que está na vertical, em cima do ponto de chão F
function heightAbove(F, d, h) {
  const D = Math.hypot(F.x, F.y);
  let da = Math.abs(Math.atan2(d[0], d[1]) - Math.atan2(F.x, F.y));
  if (da > Math.PI) da = 2 * Math.PI - da;
  if (da > 20 * D2R || hor(d) < 1e-6) return null;
  return h + (D / Math.cos(da)) * (d[2] / hor(d));
}

/* ---------- passos ---------- */
const STEPS = {
  back: { kind: "floor", at: [0.5, 1.0], title: "Parede do fundo", text: "Vire de <b>costas para o palco</b>. Mire no <b>chão, na base da parede do fundo</b>, no meio dela." },
  galFloor: { kind: "floor", at: [0.5, 0.68], title: "Galeria · chão", text: "Mire no <b>chão, logo embaixo da frente da galeria</b> (onde a borda dela cairia no piso)." },
  galUnder: { kind: "up", side: "galUnder", title: "Galeria · embaixo", text: "Sem sair do lugar, mire na <b>parte de baixo da frente da galeria</b>, em cima do ponto anterior." },
  galTop: { kind: "up", side: "galTop", title: "Galeria · mureta", text: "Mire no <b>topo da mureta</b> da galeria, em cima dos pontos anteriores." },
  galSide: { kind: "floor", at: [0.16, 0.8], mirror: true, title: "Galeria lateral · largura", text: side => `${side === "right" ? "Vire para a <b>direita</b>" : "Ainda virado para a <b>esquerda</b>"}, mire no <b>chão, embaixo da borda da galeria lateral</b> (onde a borda dela cairia no piso).` },
  galSideStart: { kind: "floor", at: [0.16, 0.6], mirror: true, title: "Galeria lateral · comprimento", text: "Mire no <b>chão, no ponto onde a galeria lateral termina</b>, o mais perto do palco, na mesma linha da borda." },
  stage: { kind: "floor", at: [0.5, 0.12], title: "Frente do palco", text: "Vire de <b>frente para o palco</b>. Mire no <b>chão, na beirada do palco</b>, no meio dele." },
  stageTop: { kind: "up", side: "stageTop", title: "Altura do palco", text: "Mire no <b>topo da beirada do palco</b>, bem em cima do ponto anterior." },
  left: { kind: "floor", at: [0.0, 0.55], title: "Parede da esquerda", text: "Vire para a <b>parede da esquerda</b>. Mire no <b>chão, na base da parede</b>." },
  ceil: { kind: "up", side: "ceil", title: "Altura do teto", text: "Sem sair do lugar, mire onde a <b>parede da esquerda encontra o teto</b>, em cima do ponto anterior. Se o teto for inclinado, mire na parte mais alta da parede." },
  right: { kind: "floor", at: [1.0, 0.55], title: "Parede da direita", text: "Vire para a <b>parede da direita</b>. Mire no <b>chão, na base da parede</b>." }
};
// side: "none" | "left" | "right" | "both" (esquerda e direita de quem olha para o palco; "both" mede o lado esquerdo e supõe igual)
const ORDER = (gal, side) => {
  const g = gal && side && side !== "none" ? ["galSide", "galSideStart"] : [];
  return ["back", ...(gal ? ["galFloor", "galUnder", "galTop"] : []), "stage", "stageTop", "left", "ceil", ...(side === "right" ? ["right", ...g] : [...g, "right"])];
};

/* ---------- cálculo ---------- */
function solve(M, h, gal, side) {
  const warns = [], P = {};
  side = gal && side && side !== "none" ? side : "none";
  for (const k of ["back", "stage", "left", "right", ...(gal ? ["galFloor"] : []), ...(side !== "none" ? ["galSide", "galSideStart"] : [])]) {
    P[k] = floorPoint(M[k], h);
    if (!P[k]) return { err: `O ponto "${STEPS[k].title}" não ficou no chão. Refaça esse passo apontando mais para baixo.` };
  }
  const ax = [P.stage.x - P.back.x, P.stage.y - P.back.y], L = Math.hypot(...ax);
  if (L < 3) return { err: "Os pontos do fundo e do palco ficaram muito perto um do outro. Refaça o scan." };
  const u = ax.map(v => v / L), n = [-u[1], u[0]];
  const W = Math.abs((P.right.x - P.left.x) * n[0] + (P.right.y - P.left.y) * n[1]);
  const Hs = heightAbove(P.stage, M.stageTop, h), Hc = heightAbove(P.left, M.ceil, h);
  if (Hs === null || Hc === null) return { err: "Um dos pontos de altura ficou longe da vertical do ponto de chão. Refaça os passos de altura sem mudar de direção." };
  const vals = { L, W, Hc, Hs: Math.max(0, Hs) };
  if (gal) {
    const under = heightAbove(P.galFloor, M.galUnder, h), top = heightAbove(P.galFloor, M.galTop, h);
    if (under === null || top === null) return { err: "Os pontos da galeria ficaram fora da vertical. Refaça os passos da galeria." };
    vals.Hg = under + 0.2;                                  // + espessura aproximada do piso
    vals.Mur = Math.max(0.3, top - vals.Hg);
    vals.Dg = (P.galFloor.x - P.back.x) * u[0] + (P.galFloor.y - P.back.y) * u[1];
    if (side !== "none") {
      const ref = side === "right" ? P.right : P.left;
      vals.Gl = Math.abs((P.galSide.x - ref.x) * n[0] + (P.galSide.y - ref.y) * n[1]);
      vals.Lg = Math.abs((P.galSideStart.x - P.back.x) * u[0] + (P.galSideStart.y - P.back.y) * u[1]);
    } else vals.Gl = 0;
  }
  // incerteza: o chão longe é pouco preciso (ângulo raso)
  let worst = 0, worstK = "";
  for (const k of Object.keys(P)) {
    const dep = -elev(M[k]) * D2R, r = EPS * D2R / (Math.sin(dep) * Math.cos(dep));
    if (r > worst) { worst = r; worstK = k; }
  }
  if (worst > 0.12) warns.push(`O ponto "${STEPS[worstK].title}" estava longe (${num(Math.hypot(P[worstK].x, P[worstK].y), 0)} m): a medida dele pode errar uns ${Math.round(worst * 100)}%. Fique mais perto desse ponto, ou corrija a escala com uma trena (abaixo).`);
  if (W < 3 || W > 40) warns.push("A largura deu fora do normal. Confira a altura do celular e refaça.");
  if (Hc < 2.5 || Hc > 20) warns.push("A altura do teto deu fora do normal. Confira a altura do celular e refaça.");
  return { vals, warns, worst, gs: { both: 0, left: 1, right: 2, none: 0 }[side] };
}

/* ---------- desenhos de ajuda ---------- */
function diagram(s, gal, side) {
  if (s.kind === "floor") {
    const X = 8 + 84 * (s.mirror && side === "right" ? 1 - s.at[0] : s.at[0]), Y = 8 + 104 * s.at[1];
    return `<svg viewBox="0 0 100 120" aria-hidden="true"><rect x="8" y="8" width="84" height="104" rx="3" fill="none" stroke="#8b9a98" stroke-width="2"/>
      <rect x="8" y="8" width="84" height="16" fill="#3a444b"/><text x="50" y="20" text-anchor="middle" font-size="9" fill="#cfd6d4">palco</text>
      ${gal ? '<rect x="8" y="84" width="84" height="28" fill="none" stroke="#8b9a98" stroke-dasharray="4 3"/><text x="50" y="102" text-anchor="middle" font-size="8" fill="#8b9a98">galeria</text>' : ""}
      ${gal && (side === "left" || side === "both") ? '<rect x="8" y="54" width="16" height="58" fill="none" stroke="#8b9a98" stroke-dasharray="4 3"/>' : ""}
      ${gal && (side === "right" || side === "both") ? '<rect x="76" y="54" width="16" height="58" fill="none" stroke="#8b9a98" stroke-dasharray="4 3"/>' : ""}
      <line x1="50" y1="64" x2="${X}" y2="${Y}" stroke="#f2b544" stroke-width="2" stroke-dasharray="4 3"/>
      <circle cx="50" cy="64" r="5" fill="#7fd3e6"/><circle cx="${X}" cy="${Y}" r="6" fill="#ff5b4f" stroke="#fff" stroke-width="2"/></svg>`;
  }
  const mk = { stageTop: [96, 80], ceil: [122, 12], galUnder: [92, 44], galTop: [92, 28] }[s.side];
  const extra = {
    stageTop: '<rect x="96" y="80" width="30" height="8" fill="#3a444b"/>',
    ceil: '<line x1="122" y1="10" x2="122" y2="88" stroke="#8b9a98" stroke-width="3"/>',
    galUnder: '<rect x="92" y="44" width="34" height="6" fill="#3a444b"/><line x1="92" y1="30" x2="92" y2="44" stroke="#8b9a98" stroke-width="3"/>',
    galTop: '<rect x="92" y="44" width="34" height="6" fill="#3a444b"/><line x1="92" y1="28" x2="92" y2="44" stroke="#8b9a98" stroke-width="3"/>'
  }[s.side];
  return `<svg viewBox="0 0 140 100" aria-hidden="true"><line x1="4" y1="88" x2="136" y2="88" stroke="#8b9a98" stroke-width="2"/>${extra}
    <circle cx="22" cy="46" r="5" fill="#7fd3e6"/><line x1="22" y1="51" x2="22" y2="88" stroke="#7fd3e6" stroke-width="3"/>
    <line x1="24" y1="46" x2="${mk[0]}" y2="${mk[1]}" stroke="#f2b544" stroke-width="2" stroke-dasharray="4 3"/>
    <circle cx="${mk[0]}" cy="${mk[1]}" r="6" fill="#ff5b4f" stroke="#fff" stroke-width="2"/></svg>`;
}

/* ---------- sessão de scan ---------- */
let S = null;
const ringLen = 2 * Math.PI * 50;

async function askSensor() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    const r = await DeviceOrientationEvent.requestPermission();
    if (r !== "granted") throw new Error("sensor");
  }
}
function msg(text, kind) {
  const m = $("#scMsg"); m.hidden = !text; m.className = "status" + (kind ? " " + kind : ""); m.innerHTML = text || "";
}
async function start() {
  msg("");
  const alt = parseFloat($("#scH").value);
  if (!(alt >= 120 && alt <= 220)) { msg("Coloque a sua altura em centímetros, por exemplo 170.", "warn"); return; }
  try { localStorage.setItem("cm_alt", String(alt)); } catch (e) {}
  const h = alt / 100 - 0.2;                      // celular na frente do rosto, um pouco abaixo dos olhos
  try {
    await askSensor();
  } catch (e) { msg("Sem permissão para os sensores de movimento. No iPhone, toque em Permitir quando o aviso aparecer; se negou, feche e abra o Safari de novo.", "warn"); return; }
  let stream;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("insecure");
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (e) {
    msg(e && e.message === "insecure" ? "A câmera só abre em endereço https." : "Não consegui abrir a câmera. Libere a permissão da câmera para este site e tente de novo.", "warn");
    return;
  }
  const gal = $("#scGal").checked;
  const side = gal ? $("#scGalSide").value : "none";
  S = { h, gal, side, stream, steps: ORDER(gal, side), i: 0, marks: {}, cur: null, anchor: null, t0: 0, acc: [], armed: true, last: null, got: 0, lock: 0 };
  const v = $("#scVideo"); v.srcObject = stream; v.play().catch(() => {});
  $("#scOverlay").hidden = false;
  window.addEventListener("deviceorientation", onOri);
  try { if ("wakeLock" in navigator) S.wl = await navigator.wakeLock.request("screen"); } catch (e) {}
  S.check = setTimeout(() => { if (S && !S.got) $("#scRead").textContent = "Este aparelho não está enviando dados de inclinação. Use o Chrome ou o Safari e tente de novo."; }, 2500);
  show();
}
function stop() {
  window.removeEventListener("deviceorientation", onOri);
  if (S) {
    clearTimeout(S.check);
    S.stream.getTracks().forEach(t => t.stop());
    if (S.wl) S.wl.release().catch(() => {});
  }
  $("#scVideo").srcObject = null;
  $("#scOverlay").hidden = true;
  S = null;
}
function show() {
  const key = S.steps[S.i], s = STEPS[key];
  $("#scNo").textContent = `Ponto ${S.i + 1} de ${S.steps.length} · ${s.title}`;
  $("#scText").innerHTML = typeof s.text === "function" ? s.text(S.side) : s.text;
  $("#scDiag").innerHTML = diagram(s, S.gal, S.side);
  $("#scRing").style.strokeDashoffset = ringLen;
  $("#scBack").disabled = S.i === 0;
}
function valid(d, s) {
  const e = elev(d);
  if (s.kind === "floor") return e < -2.5 ? "" : "Aponte mais para baixo, para o chão.";
  if (s.side === "ceil" && e < 5) return "Aponte mais para cima.";
  return "";
}
function onOri(e) {
  if (!S || e.beta == null) return;
  S.got++;
  const d = dirFrom(e.alpha || 0, e.beta, e.gamma || 0), now = performance.now();
  S.cur = d;
  const s = STEPS[S.steps[S.i]], bad = valid(d, s);
  const el = elev(d);
  if (now < S.lock) {
    $("#scRead").textContent = "Marcado! Vire para o próximo ponto."; $("#scRing").style.strokeDashoffset = ringLen; return; }
  if (!S.armed) {
    if (angle(d, S.last) > 2) S.armed = true; else { $("#scRead").textContent = "Marcado! Vire para o próximo ponto."; $("#scRing").style.strokeDashoffset = ringLen; return; }
  }
  if (bad) { S.anchor = null; $("#scRead").textContent = bad; $("#scRing").style.strokeDashoffset = ringLen; return; }
  if (!S.anchor || angle(d, S.anchor) > STEADY) { S.anchor = d; S.t0 = now; S.acc = []; }
  S.acc.push(d);
  const p = Math.min(1, (now - S.t0) / DWELL);
  $("#scRead").textContent = p > 0.15 ? "Fique parado…" : "Mire no ponto pedido";
  $("#scRing").style.strokeDashoffset = ringLen * (1 - p);
  if (p >= 1) capture(meanDir(S.acc));
}
function meanDir(a) {
  const m = [0, 0, 0];
  for (const d of a) { m[0] += d[0]; m[1] += d[1]; m[2] += d[2]; }
  const n = Math.hypot(...m); return m.map(v => v / n);
}
function capture(d) {
  const key = S.steps[S.i];
  S.marks[key] = d; S.last = d; S.armed = false; S.anchor = null; S.acc = [];
  S.lock = performance.now() + 700;
  try { navigator.vibrate && navigator.vibrate(80); } catch (e) {}
  S.i++;
  if (S.i >= S.steps.length) { finish(); return; }
  show();
}
function finish() {
  const marks = S.marks, h = S.h, gal = S.gal, side = S.side;
  stop();
  result = solve(marks, h, gal, side);
  render();
}
$("#scNow").addEventListener("click", () => {
  if (!S || !S.cur) { toast("Ainda sem leitura dos sensores. Mexa um pouco o celular."); return; }
  const bad = valid(S.cur, STEPS[S.steps[S.i]]);
  if (bad) { toast(bad); return; }
  capture(S.cur);
});
$("#scBack").addEventListener("click", () => { if (S && S.i > 0) { S.i--; delete S.marks[S.steps[S.i]]; S.armed = true; S.anchor = null; show(); } });
$("#scExit").addEventListener("click", stop);
$("#scStart").addEventListener("click", start);

/* ---------- resultado ---------- */
const NAMES = { L: "Comprimento da igreja", W: "Largura da nave", Hc: "Altura do teto", Hs: "Altura do palco", Hg: "Altura do piso da galeria", Mur: "Altura da mureta", Dg: "Quanto a galeria avança", Gl: "Galeria lateral: quanto entra na nave", Lg: "Galeria lateral: comprimento" };
let result = null;
function render() {
  const ul = $("#scRes"); ul.textContent = "";
  $("#scApply").hidden = $("#scScale").hidden = true;
  if (!result) return;
  if (result.err) { msg(result.err, "warn"); return; }
  msg("<b>Pronto!</b> Estas são as medidas que o app encontrou. Toque em <b>Aplicar na planta</b> para usar.", "ok");
  for (const [k, v] of Object.entries(result.vals)) {
    if (k === "Gl" && !(v > 0)) continue;
    const li = document.createElement("li"); li.className = "ok";
    li.innerHTML = `<span class="tag">≈</span><span></span>`;
    li.lastChild.innerHTML = `${NAMES[k]}: <b>${num(v, 1)} m</b>`;
    ul.append(li);
  }
  for (const w of result.warns) {
    const li = document.createElement("li"); li.className = "warn";
    li.innerHTML = `<span class="tag">Atenção</span><span></span>`; li.lastChild.textContent = w; ul.append(li);
  }
  $("#scApply").hidden = $("#scScale").hidden = false;
  const sel = $("#scKnown"); sel.textContent = "";
  for (const k of Object.keys(result.vals)) if (result.vals[k] > 0) sel.append(new Option(NAMES[k], k));
}
$("#scFix").addEventListener("click", () => {
  const k = $("#scKnown").value, real = parseFloat($("#scReal").value);
  if (!result || !result.vals || !(real > 0) || !(result.vals[k] > 0)) { toast("Digite a medida real em metros."); return; }
  const f = real / result.vals[k];
  if (f < 0.5 || f > 2) { toast("Essa medida está muito diferente da calculada. Refaça o scan."); return; }
  for (const key of Object.keys(result.vals)) result.vals[key] *= f;
  $("#scReal").value = "";
  render();
  toast(`Escala corrigida (× ${num(f, 2)}). Todas as medidas foram ajustadas.`);
});
$("#scApply").addEventListener("click", () => {
  if (!result || !result.vals) return;
  for (const [k, v] of Object.entries(result.vals)) window.CM.setPlan(k, Math.max(0, v));
  if ("Gl" in result.vals) window.CM.setPlan("Gs", result.gs || 0);
  if ("Hg" in result.vals && window.CM.setPlanGal) window.CM.setPlanGal(true);
  toast("Medidas aplicadas na planta. Ela já foi redesenhada.");
});
try { const a = parseFloat(localStorage.getItem("cm_alt")); if (a >= 120 && a <= 220) $("#scH").value = a; } catch (e) {}
$("#scGal").checked = window.CM.planta ? window.CM.planta.state().gal : true;
{
  const v = window.CM.planta ? window.CM.planta.state().v : { Gl: 0, Gs: 0 };
  $("#scGalSide").value = !(v.Gl > 0) ? "none" : ["both", "left", "right"][v.Gs | 0];
}
const syncSide = () => { $("#scGalSideRow").hidden = !$("#scGal").checked; };
$("#scGal").addEventListener("change", syncSide); syncSide();
for (const t of ["input", "change"]) $("#scPanel").addEventListener(t, e => e.stopPropagation());

window.CM.scan = { solve, dirFrom, floorPoint, heightAbove, setDwell: ms => { DWELL = ms; }, result: () => result };
})();
