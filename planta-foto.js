/* Caça-Microfonia — "Montar a planta por foto" (aproximado).
   Uma foto só, sem IA: as linhas parede/chão convergem num ponto de fuga, que dá a inclinação da câmera.
   Com a altura da câmera e o zoom (lido do EXIF) dá para medir distâncias no chão e alturas.
   Referencial: Z = para onde a câmera olha (horizontal), X = direita, Y = para baixo. Câmera na origem, sem rotação lateral (roll). */
"use strict";
(() => {
const { $, num, toast } = window.CM;
const D2R = Math.PI / 180;

/* ---------- vetores ---------- */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const n = Math.hypot(...a); return a.map(x => x / n); };

/* base do mundo vista da câmera, a partir do ponto de fuga do eixo da sala */
function frameFromVP(vp, cx, cy, f) {
  const a = unit([vp.x - cx, vp.y - cy, f]);
  const phi = Math.atan2(-a[1], a[2]);               // inclinação da câmera para baixo
  const Y = [0, Math.cos(phi), Math.sin(phi)];
  const X = cross(Y, a);
  return { X, Y, Z: a, phi };
}
const rayW = (fr, u, v, cx, cy, f) => { const r = [u - cx, v - cy, f]; return [dot(r, fr.X), dot(r, fr.Y), dot(r, fr.Z)]; };
// ponto do chão (plano Y = H abaixo da câmera) visto pelo raio rw
function onPlane(rw, H) {
  if (!(H > 0) || rw[1] < 0.02 * Math.hypot(...rw)) return null;
  const t = H / rw[1];
  return [rw[0] * t, H, rw[2] * t];
}
// ponto na vertical de uma profundidade Z conhecida
function atDepth(rw, Z) {
  if (rw[2] < 0.02 * Math.hypot(...rw)) return null;
  const t = Z / rw[2];
  return [rw[0] * t, rw[1] * t, Z];
}
const line2 = (p, q) => cross([p.x, p.y, 1], [q.x, q.y, 1]);
function intersect(p0, p1, q0, q1) {
  const r = cross(line2(p0, p1), line2(q0, q1));
  if (Math.abs(r[2]) < 1e-9) return null;
  return { x: r[0] / r[2], y: r[1] / r[2] };
}

/* ---------- passos de cada tipo de foto ---------- */
const WALLS = [
  "Parede da <b>ESQUERDA</b>: toque onde a parede encontra o chão, num ponto <b>perto</b> de você.",
  "Parede da <b>ESQUERDA</b>: outro ponto da mesma linha parede/chão, bem mais <b>longe</b>.",
  "Parede da <b>DIREITA</b>: toque onde a parede encontra o chão, num ponto <b>perto</b>.",
  "Parede da <b>DIREITA</b>: outro ponto da mesma linha, bem mais <b>longe</b>."
];
const STEPS = {
  A: [...WALLS,
    "<b>PALCO</b>: toque no chão, na frente do palco (onde a beirada do palco encontra o piso).",
    "<b>PALCO</b>: toque no topo da beirada do palco, <b>bem em cima</b> do ponto anterior.",
    "<b>FUNDO DO PALCO</b>: onde a parede do fundo encontra o piso do palco.",
    "<b>FUNDO DO PALCO</b>: onde essa mesma parede encontra o teto, <b>em cima</b> do ponto anterior."],
  B: [...WALLS.map(t => t.replace("toque", "toque no chão da igreja (depois da beirada do palco)")),
    "<b>GALERIA</b>: toque no chão, embaixo da frente da galeria (onde a borda dela cairia no piso).",
    "<b>GALERIA</b>: toque na parte de baixo da frente da galeria, <b>em cima</b> do ponto anterior.",
    "<b>GALERIA</b>: toque no topo da mureta, <b>em cima</b> dos pontos anteriores."]
};
const COLORS = ["#f2b544", "#f2b544", "#f2b544", "#f2b544", "#7fd3e6", "#7fd3e6", "#5fd39a", "#5fd39a"];

/* ---------- cálculo ---------- */
/* pts: pontos em pixels do canvas. P: { w, h, f, camH, dist, Hs, L } */
function solve(mode, pts, P) {
  const cx = P.w / 2, cy = P.h / 2, f = P.f, warns = [];
  if (pts.length < STEPS[mode].length) return { err: "Faltam pontos." };
  const vp = intersect(pts[0], pts[1], pts[2], pts[3]);
  if (!vp) return { err: "As duas paredes ficaram paralelas na foto. Escolha pontos mais separados em cada linha." };
  const fr = frameFromVP(vp, cx, cy, f);
  if (Math.abs(fr.phi) > 30 * D2R) warns.push(`A câmera estava inclinada ${Math.round(Math.abs(fr.phi) / D2R)}°. Tire outra foto com o celular mais na vertical, olhando reto para frente.`);
  const R = i => rayW(fr, pts[i].x, pts[i].y, cx, cy, f);
  const vals = {}, info = { phi: fr.phi / D2R };
  const bad = what => ({ err: `O ponto "${what}" ficou acima da linha do horizonte ou longe demais. Refaça esse ponto.` });

  if (mode === "A") {
    const h = P.camH;
    const l1 = onPlane(R(0), h), l2 = onPlane(R(1), h), r1 = onPlane(R(2), h), r2 = onPlane(R(3), h);
    if (!l1 || !l2 || !r1 || !r2) return bad("parede/chão");
    const W = Math.abs((r1[0] + r2[0]) / 2 - (l1[0] + l2[0]) / 2);
    const sf = onPlane(R(4), h); if (!sf) return bad("frente do palco");
    const Zf = sf[2];
    const top = atDepth(R(5), Zf); if (!top) return bad("topo do palco");
    const Hs = Math.max(0, h - top[1]);
    const sb = onPlane(R(6), h - Hs); if (!sb) return bad("fundo do palco");
    const Ps = sb[2] - Zf;
    const ce = atDepth(R(7), sb[2]); if (!ce) return bad("teto");
    const Hc = h - ce[1];
    Object.assign(vals, { L: Zf + P.dist, W, Hc, Ps, Hs });
    if (Ps < 0.5) warns.push("A profundidade do palco deu muito pequena: confira os pontos do fundo do palco.");
    if (Hc < 2.5 || Hc > 20) warns.push("A altura do teto deu fora do normal: confira o ponto do teto e a altura da câmera.");
  } else {
    const Hcam = P.Hs + P.camH;
    for (let i = 0; i < 4; i++) if (!onPlane(R(i), Hcam)) return bad("parede/chão");
    const g = onPlane(R(4), Hcam); if (!g) return bad("chão embaixo da galeria");
    const Zg = g[2];
    const u = atDepth(R(5), Zg), m = atDepth(R(6), Zg);
    if (!u || !m) return bad("galeria");
    const Hg = Hcam - u[1] + 0.2;                   // + espessura aproximada do piso
    const Mur = Hcam - m[1] - Hg;
    Object.assign(vals, { Hg, Mur, Dg: P.L - (Zg - P.dist) });
    if (Mur < 0.3 || Mur > 2) warns.push("A altura da mureta deu estranha: confira o ponto do topo da mureta.");
    if (vals.Dg < 1) warns.push("A galeria avançou muito pouco: confira o ponto do chão embaixo da galeria e a distância da câmera ao palco.");
  }
  return { vals, warns, vp, fr, info };
}

/* ---------- zoom (EXIF) ---------- */
function exifFocal35(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 < v.byteLength && v.getUint8(o) === 0xFF) {
      const mk = v.getUint8(o + 1), len = v.getUint16(o + 2);
      if (mk === 0xE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const g16 = p => v.getUint16(p, le), g32 = p => v.getUint32(p, le);
        const find = (ifd, tag) => { const n = g16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (g16(e) === tag) return e; } return -1; };
        const ep = find(t + g32(t + 4), 0x8769); if (ep < 0) return null;
        const fp = find(t + g32(ep + 8), 0xA405); if (fp < 0) return null;
        const val = g16(fp + 8);
        return val > 0 ? val : null;
      }
      o += 2 + len;
    }
  } catch (e) {}
  return null;
}
let exifF = null;
function focal35() {
  const sel = $("#pfLens").value;
  if (sel === "auto") return exifF || 26;
  return +sel;
}
// distância focal em pixels: a diagonal do filme 35 mm mede 43,27 mm
const focalPx = (w, h) => focal35() * Math.hypot(w, h) / 43.27;

/* ---------- foto e toques ---------- */
const cv = $("#pfCv"), g = cv.getContext("2d");
let mode = "A", img = null, pts = [], drag = -1, example = null;

function setImage(source, w, h) {
  img = source; cv.width = w; cv.height = h; cv.hidden = false; pts = [];
  $("#pfEmpty").hidden = true;
  refresh();
}
function loadFile(file) {
  if (!file) return;
  exifF = null;
  file.arrayBuffer().then(b => { exifF = exifFocal35(b); }).catch(() => {}).then(() => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      example = null;
      setImage(im, Math.round(im.naturalWidth * k), Math.round(im.naturalHeight * k));
      URL.revokeObjectURL(url);
      toast(exifF ? `Zoom lido da foto: ${exifF} mm` : "A foto não diz o zoom: escolhi 1x. Se usou outro zoom, ajuste em Zoom.");
    };
    im.onerror = () => toast("Não consegui abrir essa foto.");
    im.src = url;
  });
}
$("#pfCam").addEventListener("change", e => { loadFile(e.target.files[0]); e.target.value = ""; });
$("#pfGal").addEventListener("change", e => { loadFile(e.target.files[0]); e.target.value = ""; });

function params() {
  const plan = window.CM.planta ? window.CM.planta.state().v : { Hs: 0.6, L: 20 };
  return { w: cv.width, h: cv.height, f: focalPx(cv.width, cv.height), camH: parseFloat($("#pfH").value) || 1.4, dist: parseFloat($("#pfD").value) || 0, Hs: plan.Hs, L: plan.L };
}

const toImg = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
cv.addEventListener("pointerdown", e => {
  if (!img) return;
  e.preventDefault();
  const p = toImg(e), s = cv.width / 430;
  const full = pts.length >= STEPS[mode].length;
  let k = -1, best = full ? 30 * s : 0; // faltando ponto: o toque sempre cria o próximo; depois de completo, arrasta o mais perto
  pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < best) { best = d; k = i; } });
  if (k < 0 && pts.length < STEPS[mode].length) { pts.push(p); k = pts.length - 1; }
  drag = k;
  try { cv.setPointerCapture(e.pointerId); } catch (x) {}
  refresh();
});
cv.addEventListener("pointermove", e => { if (drag >= 0) { pts[drag] = toImg(e); refresh(); } });
const endDrag = () => { drag = -1; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

/* ---------- desenho ---------- */
function render(res) {
  if (!img) return;
  const s = cv.width / 430;
  g.drawImage(img, 0, 0, cv.width, cv.height);
  g.lineWidth = 1.5 * s;
  const ext = (a, b, col) => {
    const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1, t = 4 * cv.width / n;
    g.strokeStyle = col; g.beginPath(); g.moveTo(a.x - dx / n * t, a.y - dy / n * t); g.lineTo(a.x + dx / n * t, a.y + dy / n * t); g.stroke();
  };
  g.save(); g.globalAlpha = 0.7;
  if (pts.length >= 2) ext(pts[0], pts[1], "#f2b544");
  if (pts.length >= 4) ext(pts[2], pts[3], "#f2b544");
  if (res && res.vp) {
    g.setLineDash([8 * s, 6 * s]); g.strokeStyle = "#ffffff";
    g.beginPath(); g.moveTo(0, res.vp.y); g.lineTo(cv.width, res.vp.y); g.stroke();
  }
  g.restore();
  g.font = `700 ${13 * s}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  pts.forEach((p, i) => {
    g.fillStyle = COLORS[i]; g.strokeStyle = "#000"; g.lineWidth = 2 * s;
    g.beginPath(); g.arc(p.x, p.y, 10 * s, 0, 7); g.fill(); g.stroke();
    g.fillStyle = "#000"; g.fillText(String(i + 1), p.x, p.y + 0.5 * s);
  });
}

/* ---------- resultado ---------- */
const NAMES = {
  L: ["Comprimento da igreja", "m"], W: ["Largura da nave", "m"], Hc: ["Altura do teto", "m"], Ps: ["Profundidade do palco", "m"], Hs: ["Altura do palco", "m"],
  Hg: ["Altura do piso da galeria", "m"], Mur: ["Altura da mureta", "m"], Dg: ["Quanto a galeria avança", "m"]
};
let current = null;
function refresh() {
  const steps = STEPS[mode], n = pts.length, st = $("#pfStep");
  const res = n >= steps.length && img ? solve(mode, pts, params()) : null;
  render(res);
  current = res && !res.err ? res : null;
  st.hidden = !img;
  if (img) {
    if (n < steps.length) { st.className = "status"; st.innerHTML = `<b>Passo ${n + 1} de ${steps.length}.</b> ${steps[n]}`; }
    else if (res.err) { st.className = "status warn"; st.innerHTML = res.err + " Arraste um ponto para corrigir."; }
    else { st.className = "status ok"; st.innerHTML = "<b>Pronto.</b> Confira as medidas abaixo. Se algum ponto ficou fora do lugar, arraste ele que o cálculo refaz."; }
  }
  const ul = $("#pfRes");
  ul.textContent = "";
  if (current) {
    for (const [k, v] of Object.entries(current.vals)) {
      const li = document.createElement("li"); li.className = "ok";
      li.innerHTML = `<span class="tag">≈</span><span></span>`;
      li.lastChild.innerHTML = `${NAMES[k][0]}: <b>${num(Math.max(0, v), 1)} m</b>`;
      ul.append(li);
    }
    for (const w of current.warns) {
      const li = document.createElement("li"); li.className = "warn";
      li.innerHTML = `<span class="tag">Atenção</span><span></span>`; li.lastChild.textContent = w; ul.append(li);
    }
  }
  $("#pfApply").hidden = !current;
  $("#pfUndo").disabled = !n; $("#pfClear").disabled = !img;
}
$("#pfUndo").addEventListener("click", () => { pts.pop(); refresh(); });
$("#pfZoom").addEventListener("click", () => {
  const big = $("#pfBox").classList.toggle("big");
  $("#pfZoom").textContent = big ? "Reduzir foto" : "Ampliar foto";
});
$("#pfClear").addEventListener("click", () => { pts = []; refresh(); });
$("#pfApply").addEventListener("click", () => {
  if (!current) return;
  for (const [k, v] of Object.entries(current.vals)) window.CM.setPlan(k, Math.max(0, v));
  if (mode === "B" && window.CM.setPlanGal) window.CM.setPlanGal(true);
  toast("Medidas aplicadas na planta. Confira os campos e ajuste o que estiver estranho.");
});

/* modo e parâmetros */
function setMode(m) {
  mode = m; pts = [];
  document.querySelectorAll("#pfPanel .pfb").forEach(b => b.classList.toggle("on", b.dataset.pfm === m));
  $("#pfDl").textContent = m === "A" ? "Distância da câmera até a parede do fundo (m)" : "Distância da câmera até a beirada do palco (m)";
  $("#pfD").value = m === "A" ? 0 : 1;
  $("#pfHint").innerHTML = m === "A"
    ? "Fique <b>no fundo da igreja</b>, encostado na parede, com o celular na altura do peito, <b>reto</b> (sem apontar para cima ou para baixo) e olhando para o palco. Pegue o chão dos dois lados, o palco e o teto na foto."
    : "Suba no palco, perto da beirada, celular na altura do peito, <b>reto</b>, olhando para o fundo da igreja. Pegue o chão dos dois lados e a frente da galeria. Precisa do comprimento da igreja já preenchido na planta.";
  if (m === "A" && window.CM.planta && window.CM.planta.state().gal) {
    $("#pfHint").innerHTML += " <b>Tem galeria:</b> não tire a foto debaixo dela, porque o teto que aparece seria o da galeria. Fique <b>logo na frente da borda da galeria</b>, no chão da igreja, e preencha abaixo a distância até a parede do fundo (use passos ou AR). Depois use a foto do palco para o fundo para medir a galeria.";
  }
  if (img && example) { example.make(m); } else refresh();
}
document.querySelectorAll("#pfPanel .pfb").forEach(b => b.addEventListener("click", () => setMode(b.dataset.pfm)));
for (const id of ["#pfH", "#pfD", "#pfLens"]) $(id).addEventListener("input", refresh);
// o que acontece neste painel não deve contar como edição da planta
for (const t of ["input", "change"]) $("#pfPanel").addEventListener(t, e => e.stopPropagation());

/* ---------- exemplo sintético (também usado nos testes) ---------- */
function makeExample(m) {
  const w = 1200, h = 900, cx = w / 2, cy = h / 2, f = 26 * Math.hypot(w, h) / 43.27;
  const plan = window.CM.planta.state().v;
  const phi = 7 * D2R, psi = 6 * D2R;
  const Yc = [0, Math.cos(phi), Math.sin(phi)];
  const Zc = [Math.sin(psi), -Math.cos(psi) * Math.sin(phi), Math.cos(psi) * Math.cos(phi)];
  const Xc = cross(Yc, Zc);
  const proj = p => { const c = [dot(p, Xc), dot(p, Yc), dot(p, Zc)]; return { x: cx + f * c[0] / c[2], y: cy + f * c[1] / c[2], z: c[2] }; };
  const camH = 1.4, W = 11, L = m === "A" ? 18 : plan.L, Ps = 4, Hs = m === "A" ? 0.7 : plan.Hs, Hc = 6.5;
  const dist = m === "A" ? 0.5 : 1, Hcam = m === "A" ? camH : Hs + camH;
  const xl = -W / 2 - 0.4, xr = W / 2 - 0.4;                          // câmera fora do centro
  const Zf = m === "A" ? L - dist : 0, Zb = m === "A" ? Zf + Ps : L + dist;
  const Hg = 3.2, Mur = 1, Dg = 6, Zg = (L - Dg) + dist;
  const off = document.createElement("canvas"); off.width = w; off.height = h;
  const c = off.getContext("2d");
  const poly = (pp, fill, stroke) => {
    const q = pp.map(proj); if (q.some(a => a.z < 0.25)) return;
    c.beginPath(); q.forEach((a, i) => i ? c.lineTo(a.x, a.y) : c.moveTo(a.x, a.y)); c.closePath();
    c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
  };
  c.fillStyle = "#222"; c.fillRect(0, 0, w, h);
  const z0 = 0.6, yf = Hcam, yc = Hcam - Hc;
  poly([[xl, yc, z0], [xr, yc, z0], [xr, yc, Zb], [xl, yc, Zb]], "#cfd3d6");                  // teto
  poly([[xl, yc, z0], [xl, yf, z0], [xl, yf, Zb], [xl, yc, Zb]], "#b9a98c");                  // parede esquerda
  poly([[xr, yc, z0], [xr, yf, z0], [xr, yf, Zb], [xr, yc, Zb]], "#a89a80");                  // parede direita
  poly([[xl, yc, Zb], [xr, yc, Zb], [xr, yf, Zb], [xl, yf, Zb]], "#8e8473");                  // parede do fundo
  poly([[xl, yf, z0], [xr, yf, z0], [xr, yf, Zb], [xl, yf, Zb]], "#6b6358");                  // piso
  for (let z = Math.ceil(z0); z < Zb; z++) { const a = proj([xl, yf, z]), b = proj([xr, yf, z]); if (a.z > 0.25) { c.strokeStyle = "rgba(0,0,0,.18)"; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); } }
  let pk;
  if (m === "A") {
    poly([[xl, yf - Hs, Zf], [xr, yf - Hs, Zf], [xr, yf - Hs, Zb], [xl, yf - Hs, Zb]], "#4a4f55", "#222");   // topo do palco
    poly([[xl, yf - Hs, Zf], [xr, yf - Hs, Zf], [xr, yf, Zf], [xl, yf, Zf]], "#2f3338", "#111");              // frente do palco
    const X = 0.5;
    pk = [[xl, yf, 14], [xl, yf, 17], [xr, yf, 9], [xr, yf, 15], [X, yf, Zf], [X, yf - Hs, Zf], [X, yf - Hs, Zb], [X, yc, Zb]];
  } else {
    poly([[xl, Hcam - (Hg - 0.2) , Zg], [xr, Hcam - (Hg - 0.2), Zg], [xr, Hcam - Hg - Mur, Zg], [xl, Hcam - Hg - Mur, Zg]], "#5b4a3a", "#222");   // frente da galeria
    const X = 0.5;
    pk = [[xl, yf, 12], [xl, yf, 18], [xr, yf, 7], [xr, yf, 16], [X, yf, Zg], [X, Hcam - (Hg - 0.2), Zg], [X, Hcam - Hg - Mur, Zg]];
  }
  example = { make: setModeImage, taps: () => pk.map(proj).map(a => ({ x: a.x, y: a.y })), truth: { L, W, Hc, Ps, Hs, Hg, Mur, Dg }, dist, camH };
  exifF = null;
  $("#pfH").value = camH; $("#pfD").value = dist; $("#pfLens").value = "26";
  setImage(off, w, h);
}
function setModeImage(m) { makeExample(m); }
$("#pfEx").addEventListener("click", () => { makeExample(mode); toast("Foto de exemplo. Siga os passos tocando nos pontos."); });

window.CM.foto = { solve, exifFocal35, example: () => example, pts: () => pts };
setMode("A");
})();
