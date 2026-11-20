/* Caça-Microfonia — aba "Caixas": inclinômetro pelo sensor do celular, distância no chão com AR (WebXR)
   e as Contas rápidas (cobertura, diferença de volume, delay). */
"use strict";
(() => {
const { $, num, setCalc, toast } = window.CM;

/* ================= Inclinômetro ================= */
let incOn = false, incOffset = 0, samples = [], locked = null, lastShow = 0, gotEvent = false;
try { incOffset = parseFloat(localStorage.getItem("cm_incOffset")) || 0; } catch (e) {}

// Costas do celular encostadas na frente da caixa, celular em pé: beta = 90° com a caixa reta.
// Caixa apontando para baixo -> a tela vira para baixo -> beta passa de 90°.
const tiltFrom = beta => beta - 90 - incOffset;

function showTilt(t, isLocked) {
  const a = Math.abs(t), r = Math.round(a);
  $("#incVal").textContent = (a < 0.5 ? "0" : r) + "°";
  $("#incDir").textContent = a < 0.5 ? "Caixa reta (apontando na horizontal)" : t > 0 ? "Para baixo" : "Para cima";
  $("#incArrow").style.transform = `rotate(${Math.max(-60, Math.min(60, t))}deg)`;
  const st = $("#incState");
  st.hidden = false;
  st.className = "chip" + (isLocked ? " locked" : "");
  st.textContent = isLocked ? "Travado · pode tirar o celular" : "Medindo… segure parado";
}

function onOrientation(e) {
  if (e.beta == null) return;
  gotEvent = true;
  const now = performance.now();
  const t = tiltFrom(e.beta);
  samples.push([now, t]);
  while (samples.length && now - samples[0][0] > 1500) samples.shift();
  if (locked !== null) return;
  if (now - lastShow > 90) { lastShow = now; showTilt(t, false); }
  // trava quando ficar parado 1,5 s com variação menor que 0,4°
  if (samples.length > 10 && now - samples[0][0] > 1300) {
    let mn = Infinity, mx = -Infinity, s = 0;
    for (const [, v] of samples) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
    if (mx - mn < 0.4 && Math.abs(s / samples.length) < 75) {
      locked = s / samples.length;
      showTilt(locked, true);
      $("#btnIncAgain").hidden = false; $("#btnIncUse").hidden = false;
      try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (err) {}
    }
  }
}

async function startInc() {
  $("#incMsg").hidden = true;
  let denied = false;
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission(); // iPhone pede permissão
      denied = r !== "granted";
    }
  } catch (err) { denied = true; }
  // mesmo sem "granted" escuta o sensor: alguns navegadores respondem "negado" mas mandam os dados
  if (!incOn) window.addEventListener("deviceorientation", onOrientation);
  incOn = true; locked = null; samples = []; gotEvent = false;
  $("#btnInc").textContent = "Desligar"; $("#btnInc").className = "btn stop";
  $("#incDir").textContent = "Encoste o celular na frente da caixa…";
  setTimeout(() => {
    if (!incOn || gotEvent) return;
    incMsg(denied
      ? "O sensor não foi liberado. No iPhone: feche e abra o app de novo e toque em Permitir quando ele perguntar. No Android: libere \"Sensores de movimento\" nas configurações do site."
      : "Este aparelho não mandou dados do sensor de inclinação. Use num celular (computador não tem esse sensor).");
    stopInc();
  }, 2500);
}
function stopInc() {
  window.removeEventListener("deviceorientation", onOrientation);
  incOn = false;
  $("#btnInc").textContent = "Ligar inclinômetro"; $("#btnInc").className = "btn primary";
  $("#incState").hidden = true;
}
function incMsg(t) { const m = $("#incMsg"); m.textContent = t; m.hidden = false; }

$("#btnInc").addEventListener("click", () => incOn ? stopInc() : startInc());
$("#btnIncAgain").addEventListener("click", () => {
  locked = null; samples = [];
  $("#btnIncAgain").hidden = true; $("#btnIncUse").hidden = true;
  if (!incOn) startInc();
});
$("#btnIncUse").addEventListener("click", () => { if (locked !== null) setCalc("cTilt", Math.round(locked), "Inclinação"); });
$("#btnIncZero").addEventListener("click", () => {
  const last = samples.length ? samples[samples.length - 1][1] + incOffset : null;
  if (!incOn || last === null) { incMsg("Ligue o inclinômetro, encoste o celular no batente da porta e toque em Calibrar no zero."); return; }
  incOffset = last; locked = null; samples = [];
  try { localStorage.setItem("cm_incOffset", String(incOffset)); } catch (e) {}
  toast("Calibrado: o batente agora marca 0°");
});

/* ================= Distância com AR (Android + Chrome + ARCore) ================= */
let xr = null; // { session, gl, ref, hit, pts:[], cur }
let lastAR = null;

async function arSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar")); } catch (e) { return false; }
}
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ua = navigator.userAgent;
const isAndroid = /Android/i.test(ua);
const otherBrowser = /MiuiBrowser|XiaoMi|SamsungBrowser|Firefox|OPR\/|EdgA|HeyTapBrowser|UCBrowser/i.test(ua);
(async () => {
  if (await arSupported()) { $("#arMsg").textContent = "Este celular aceita medição AR."; return; }
  let msg;
  if (isIOS) msg = "O Safari do iPhone não tem AR para sites. Use o app Medida, que já vem no iPhone, ou o contador de passos abaixo.";
  else if (isAndroid && otherBrowser) msg = "Este navegador não tem AR. Abra o app no Google Chrome (no Xiaomi, o navegador que vem instalado não serve) e tente de novo. Se continuar sem AR, use o contador de passos abaixo.";
  else if (isAndroid) msg = "Este celular não tem AR para sites. O Google só libera em aparelhos da lista do ARCore (por exemplo, o Redmi Note 13 comum não está, só o 13 Pro+). Use o contador de passos abaixo ou uma trena.";
  else msg = "AR só funciona no celular (Chrome de Android com ARCore). Aqui, use o contador de passos no celular ou uma trena.";
  $("#arMsg").textContent = msg;
  $("#btnAR").disabled = true;
})();

async function startAR() {
  const overlay = $("#arOverlay");
  try {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test", "local"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: overlay }
    });
    const glc = document.createElement("canvas");
    const gl = glc.getContext("webgl", { xrCompatible: true, alpha: true });
    await gl.makeXRCompatible?.();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const ref = await session.requestReferenceSpace("local");
    const viewer = await session.requestReferenceSpace("viewer");
    const hit = await session.requestHitTestSource({ space: viewer });
    xr = { session, gl, ref, hit, pts: [], cur: null };
    overlay.hidden = false;
    $("#arText").textContent = "Mova o celular devagar apontando para o chão…";
    session.addEventListener("end", endAR);
    session.requestAnimationFrame(onXR);
  } catch (err) {
    $("#arMsg").textContent = "Não consegui abrir o AR: " + (err.message || err.name) + ". Verifique se o Google Play Services para RA está instalado e se a câmera foi liberada.";
    overlay.hidden = true;
  }
}
function endAR() {
  $("#arOverlay").hidden = true;
  if (xr && xr.hit) try { xr.hit.cancel(); } catch (e) {}
  xr = null;
  if (lastAR) {
    $("#arResult").hidden = false;
    $("#arVal").textContent = num(lastAR, 2) + " m";
  }
}
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function describe(a, b) {
  const total = d3(a, b), floor = Math.hypot(a.x - b.x, a.z - b.z), up = Math.abs(a.y - b.y);
  return { total, floor, up, text: `${num(floor, 2)} m no chão` + (up > 0.15 ? ` · ${num(up, 2)} m de altura · ${num(total, 2)} m em linha reta` : "") };
}

function project(p, view, W, H) {
  const V = view.transform.inverse.matrix, P = view.projectionMatrix;
  const v = [p.x, p.y, p.z, 1], e = [0, 0, 0, 0], c = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) e[i] = V[i] * v[0] + V[4 + i] * v[1] + V[8 + i] * v[2] + V[12 + i] * v[3];
  for (let i = 0; i < 4; i++) c[i] = P[i] * e[0] + P[4 + i] * e[1] + P[8 + i] * e[2] + P[12 + i] * e[3];
  if (c[3] <= 0) return null;
  return { x: (c[0] / c[3] + 1) / 2 * W, y: (1 - c[1] / c[3]) / 2 * H };
}

function onXR(t, frame) {
  if (!xr) return;
  const { session, gl, ref, hit } = xr;
  session.requestAnimationFrame(onXR);
  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  const pose = frame.getViewerPose(ref);
  if (!pose) return;
  const hits = frame.getHitTestResults(hit);
  if (hits.length) { const p = hits[0].getPose(ref).transform.position; xr.cur = { x: p.x, y: p.y, z: p.z }; }
  else xr.cur = null;
  $("#arCross").classList.toggle("hit", !!xr.cur);

  // texto
  const pts = xr.pts;
  let txt;
  if (!xr.cur && !pts.length) txt = "Mova o celular devagar apontando para o chão…";
  else if (pts.length === 0) txt = "Mire no começo e toque em Marcar ponto";
  else if (pts.length === 1) txt = xr.cur ? describe(pts[0], xr.cur).text : "Procurando o chão…";
  else txt = "Medida: " + describe(pts[0], pts[1]).text + ". Marque de novo para outra medida.";
  $("#arText").textContent = txt;

  // linha e pontos desenhados por cima da câmera
  const svg = $("#arSvg"), W = svg.clientWidth, H = svg.clientHeight, view = pose.views[0];
  const shown = pts.length === 1 && xr.cur ? [pts[0], xr.cur] : pts;
  const sp = shown.map(p => project(p, view, W, H));
  let html = "";
  if (sp.length === 2 && sp[0] && sp[1]) html += `<line x1="${sp[0].x}" y1="${sp[0].y}" x2="${sp[1].x}" y2="${sp[1].y}" stroke="#f2b544" stroke-width="4" stroke-linecap="round"/>`;
  sp.forEach(p => { if (p) html += `<circle cx="${p.x}" cy="${p.y}" r="9" fill="#f2b544" stroke="#fff" stroke-width="3"/>`; });
  svg.innerHTML = html;
}

$("#btnAR").addEventListener("click", startAR);
$("#arOverlay").addEventListener("beforexrselect", e => e.preventDefault());
$("#arMark").addEventListener("click", () => {
  if (!xr || !xr.cur) { toast("Ainda não achei o chão. Mova o celular devagar."); return; }
  if (xr.pts.length >= 2) xr.pts = [];
  xr.pts.push({ ...xr.cur });
  if (xr.pts.length === 2) {
    lastAR = describe(xr.pts[0], xr.pts[1]).floor;
    try { navigator.vibrate && navigator.vibrate(60); } catch (e) {}
  }
});
$("#arUndo").addEventListener("click", () => { if (xr) xr.pts.pop(); });
$("#arExit").addEventListener("click", () => { if (xr) xr.session.end(); else endAR(); });
document.querySelectorAll("[data-ar-to]").forEach(b => b.addEventListener("click", () => {
  if (lastAR) setCalc(b.dataset.arTo, lastAR, b.textContent.replace("Usar como ", "").replace(/^./, c => c.toUpperCase()));
}));

/* ================= Contador de passos (acelerômetro) ================= */
let pedOn = false, pedCal = false, steps = 0, fast = 9.8, slow = 9.8, armed = true, lastStep = 0, gotMotion = false;
try { const v = parseFloat(localStorage.getItem("cm_stepLen")); if (v > 0.3 && v < 1.3) $("#pedLen").value = v.toFixed(2); } catch (e) {}
const stepLen = () => { const v = parseFloat($("#pedLen").value); return v > 0 ? v : 0.75; };
function pedShow() {
  $("#pedVal").textContent = num(steps * stepLen(), 1) + " m";
  $("#pedSteps").textContent = steps + (steps === 1 ? " passo" : " passos");
}
// Cada passo dá um pico na força total do acelerômetro. Filtro rápido menos filtro lento = só o balanço do passo.
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  gotMotion = true;
  const m = Math.hypot(a.x, a.y, a.z);
  fast = fast * 0.75 + m * 0.25;
  slow = slow * 0.97 + m * 0.03;
  const d = fast - slow, now = performance.now();
  if (armed && d > 1.1 && now - lastStep > 280) {
    steps++; lastStep = now; armed = false; pedShow();
  } else if (!armed && d < 0) armed = true;
}
async function startPed(calibrate) {
  $("#pedMsg").hidden = true;
  let denied = false;
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function")
      denied = (await DeviceMotionEvent.requestPermission()) !== "granted";
  } catch (err) { denied = true; }
  steps = 0; armed = true; lastStep = 0; gotMotion = false; fast = slow = 9.8;
  pedOn = true; pedCal = calibrate;
  window.addEventListener("devicemotion", onMotion);
  $("#btnPed").textContent = "Parar"; $("#btnPed").className = "btn stop";
  $("#btnPedCal").disabled = true; $("#pedResult").hidden = true;
  pedShow();
  if (calibrate) toast("Ande os 10 m marcados e toque em Parar");
  setTimeout(() => {
    if (!pedOn || gotMotion) return;
    const m = $("#pedMsg");
    m.textContent = denied
      ? "O sensor de movimento não foi liberado. No iPhone, feche e abra o app e toque em Permitir. No Android, libere \"Sensores de movimento\" nas configurações do site."
      : "Este aparelho não mandou dados do acelerômetro. Use num celular.";
    m.hidden = false; stopPed();
  }, 2500);
}
function stopPed() {
  window.removeEventListener("devicemotion", onMotion);
  const wasCal = pedCal;
  pedOn = false; pedCal = false;
  $("#btnPed").textContent = "Começar"; $("#btnPed").className = "btn primary";
  $("#btnPedCal").disabled = false;
  if (wasCal) {
    if (steps >= 6) {
      const len = 10 / steps;
      $("#pedLen").value = len.toFixed(2);
      try { localStorage.setItem("cm_stepLen", len.toFixed(3)); } catch (e) {}
      toast(`Passo calibrado: ${num(len, 2)} m (${steps} passos em 10 m)`);
    } else toast("Poucos passos contados. Tente calibrar de novo, andando normal.");
  } else if (steps > 0) $("#pedResult").hidden = false;
  pedShow();
}
$("#btnPed").addEventListener("click", () => pedOn ? stopPed() : startPed(false));
$("#btnPedCal").addEventListener("click", () => startPed(true));
$("#pedPlus").addEventListener("click", () => { steps++; pedShow(); if (!pedOn && steps) $("#pedResult").hidden = false; });
$("#pedMinus").addEventListener("click", () => { steps = Math.max(0, steps - 1); pedShow(); });
$("#pedLen").addEventListener("input", () => {
  pedShow();
  const v = parseFloat($("#pedLen").value);
  if (v > 0.3 && v < 1.3) try { localStorage.setItem("cm_stepLen", String(v)); } catch (e) {}
});
document.querySelectorAll("[data-ped-to]").forEach(b => b.addEventListener("click", () => {
  if (steps) setCalc(b.dataset.pedTo, steps * stepLen(), b.textContent.replace("Usar como ", "").replace(/^./, c => c.toUpperCase()));
}));
pedShow();

/* ================= Contas rápidas ================= */
const val = id => parseFloat($(id).value);
function calc() {
  const h = val("#cH"), t = val("#cTilt"), ear = val("#cEar"), d2 = val("#cD2"), d1 = val("#cD1");
  const drop = h - ear;
  let aim;
  if (!(drop > 0)) aim = "A caixa está na altura do ouvido ou abaixo. O som bate nas primeiras pessoas e não chega bem no fundo: suba a caixa.";
  else if (!(t > 0)) aim = `Caixa reta (0°): o centro do som passa <b>${num(drop, 1)} m</b> acima do ouvido em toda a igreja e vai bater na parede do fundo.`;
  else {
    const d = drop / Math.tan(t * Math.PI / 180);
    aim = `O centro do som chega na altura do ouvido a <b>≈ ${num(d, 1)} m</b> da caixa.`;
    if (d2 > 0) {
      const ideal = Math.atan(drop / (d2 * 0.7)) * 180 / Math.PI;
      aim += ` Para cobrir bem até o fundo (${num(d2, 1)} m), mire em uns 70% da igreja: inclinação de <b>≈ ${Math.round(ideal)}°</b>.`;
      if (d < d2 * 0.4) aim += " Do jeito que está, o som cai cedo demais e o fundo fica fraco.";
      else if (d > d2) aim += " Do jeito que está, o som passa por cima do público e bate na parede do fundo (eco).";
    }
  }
  $("#rAim").innerHTML = aim;

  if (d1 > 0 && d2 > 0) {
    const diff = 20 * Math.log10(d2 / d1);
    let txt = `O fundo ouve <b>≈ ${Math.round(diff)} dB a menos</b> que a 1ª fila.`;
    txt += diff <= 6 ? " Diferença boa." : diff <= 10 ? " Aceitável. Subir ou inclinar melhor a caixa ajuda a equilibrar." : " Diferença grande: a frente fica alta demais e o fundo não entende. Suba a caixa, mire mais para o fundo ou use caixa de reforço no meio da igreja.";
    $("#rDb").innerHTML = txt;
  } else $("#rDb").textContent = "";

  const dd = val("#cDd");
  if (dd > 0) {
    const ms = dd / 343 * 1000;
    $("#rDelay").innerHTML = `O som leva <b>≈ ${Math.round(ms)} ms</b> para andar ${num(dd, 1)} m. Ajuste o delay da caixa de reforço para <b>≈ ${Math.round(ms + 5)} a ${Math.round(ms + 10)} ms</b>, para o som parecer vir da frente. Precisa de processador ou caixa com delay; sem isso, deixe o reforço mais baixo.`;
  } else $("#rDelay").textContent = "";
}
["#cH", "#cTilt", "#cEar", "#cD1", "#cD2", "#cDd"].forEach(id => $(id).addEventListener("input", calc));
calc();
})();
