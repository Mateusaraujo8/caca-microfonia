/* Caça-Microfonia — "Medir o som real da igreja".
   O som da mesa toca ruído rosa (o celular gera e você liga no som); a pessoa anda pela igreja, toca na planta onde está
   e o app mede o volume médio por 3 s com o microfone. Com 3 pontos ou mais vira um mapa real, comparado com o cálculo. */
"use strict";
(() => {
const { $, num, toast } = window.CM;
const P = () => window.CM.planta;
let ctx = null, node = null, autoStop = 0, busy = false;

/* ---------- ruído rosa ---------- */
function startNoise() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  node = ctx.createBufferSource(); node.buffer = buf; node.loop = true;
  const g = ctx.createGain(); g.gain.value = 0.15;
  node.connect(g).connect(ctx.destination); node.start();
  autoStop = setTimeout(stopNoise, 10 * 60 * 1000);   // segurança: desliga sozinho em 10 min
  ui();
}
function stopNoise() {
  clearTimeout(autoStop);
  try { node && node.stop(); } catch (e) {}
  if (ctx) ctx.close().catch(() => {});
  node = ctx = null;
  ui();
}
$("#mdNoise").addEventListener("click", () => (node ? stopNoise() : startNoise()));

/* ---------- medir ---------- */
function msg(t, kind) { const m = $("#mdMsg"); m.hidden = !t; m.className = "status" + (kind ? " " + kind : ""); m.innerHTML = t || ""; }
async function measureHere() {
  if (busy) return;
  const pick = P().getPick();
  if (!pick) { msg("Toque na <b>planta</b> (ao lado ou acima), no lugar onde você está agora, e depois toque em Medir aqui.", "warn"); return; }
  if (!window.__mic || !(await window.__mic.ensure())) { msg("Preciso do microfone. Libere a permissão e tente de novo.", "warn"); return; }
  busy = true; ui();
  const t0 = performance.now();
  const tick = setInterval(() => { msg(`Medindo… fique parado e em silêncio (${Math.max(0, 3 - (performance.now() - t0) / 1000).toFixed(0)} s)`); }, 250);
  const L = await window.__mic.measure(3000);
  clearInterval(tick); busy = false;
  if (!isFinite(L)) { msg("Não consegui medir. Tente de novo.", "warn"); ui(); return; }
  P().addMeas({ x: pick.x, y: pick.y, L: Math.round(L * 10) / 10 });
  P().setPick(null);
  if (P().state().meas.length >= 3) { $("#mdShow").checked = true; P().setShow(true); }
  msg(node ? `Ponto ${P().state().meas.length} medido. Vá para o próximo lugar e toque nele na planta.` : `Ponto ${P().state().meas.length} medido, mas o <b>ruído rosa estava desligado</b>: o mapa só vale com o ruído tocando no som.`, node ? "ok" : "warn");
  ui();
}
$("#mdGo").addEventListener("click", measureHere);
$("#mdClear").addEventListener("click", () => { P().clearMeas(); $("#mdShow").checked = false; msg(""); ui(); });
$("#mdShow").addEventListener("change", e => P().setShow(e.target.checked));
window.CM.onDraw = () => { if ($("#mdBar")) $("#mdBar").hidden = P().state().view !== "top"; };
window.CM.onPick = pick => { if (pick) { P().setView("top"); } ui(); };   // tocar na planta já prepara a medida

/* ---------- tela ---------- */
function ui() {
  const meas = P() ? P().state().meas : [];
  $("#mdBar").hidden = !P() || P().state().view !== "top";
  $("#mdNoise").textContent = node ? "Parar ruído rosa" : "Tocar ruído rosa";
  $("#mdNoise").className = "btn small " + (node ? "stop" : "primary");
  $("#mdGo").disabled = busy;
  $("#mdShow").disabled = meas.length < 3;
  $("#mdShow").checked = meas.length >= 3 && P().state().showMeas;
  const ul = $("#mdList"); ul.textContent = "";
  if (!meas.length) return;
  const med = [...meas].map(m => m.L).sort((a, b) => a - b)[Math.floor(meas.length / 2)];
  meas.forEach((m, i) => {
    const li = document.createElement("li"); li.className = meas.length >= 3 && m.L - med < -4 ? "warn" : "ok";
    li.innerHTML = `<span class="tag"></span><span></span>`;
    li.firstChild.textContent = `Ponto ${i + 1}`;
    li.lastChild.innerHTML = `<b>${num(m.L, 1)} dB</b> · a ${num(m.x, 1)} m do palco, ${num(m.y, 1)} m da borda de cima`;
    const del = document.createElement("button"); del.className = "btn small"; del.textContent = "×"; del.style.marginLeft = "8px"; del.setAttribute("aria-label", "Apagar ponto");
    del.onclick = () => { P().delMeas(i); ui(); };
    li.lastChild.append(del);
    ul.append(li);
  });
}
for (const t of ["input", "change", "click"]) $("#mdPanel").addEventListener(t, e => e.stopPropagation());
ui();
})();
