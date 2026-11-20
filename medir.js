/* Caça-Microfonia — aba "Medir pela foto".
   Referência manual (porta, A4, trena) ou automática (marcador impresso com QR "CM:<mm>"),
   correção de perspectiva pelo marcador (homografia) e ponto que gruda na borda. */
"use strict";
(() => {
const { $, num, css, setCalc } = window.CM;
const cv = $("#photo"), g = cv.getContext("2d");
let img = null, iw = 0, ih = 0, scale = 1, dpr = 1;
let mode = "ref", lines = [], pending = null, drag = null;
let marker = null;          // { corners:[tl,tr,br,bl] em pixels da foto, H: foto -> quadrado 0..1, mm }
let gray = null, gw = 0, gh = 0, gk = 1;   // cópia em tons de cinza (até 2000 px) para grudar na borda
let C = {}, detectToken = 0;

const HINTS = {
  ref: "Marque as duas pontas de algo com tamanho conhecido (porta, folha A4, trena). Se a foto tiver o marcador impresso, o app acha sozinho e você pula esta etapa.",
  len: "Toque nas duas pontas do que quer medir, por exemplo do chão até o meio da caixa. Arraste as bolinhas para acertar.",
  ang: "Numa foto de lado da caixa, marque a frente da caixa: primeiro em cima, depois embaixo. (O inclinômetro da aba Caixas é mais preciso.)"
};

/* ---------- modo ---------- */
function setMode(m) {
  mode = m; pending = null;
  document.querySelectorAll("#viewMed .segb").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  $("#hint").textContent = HINTS[m];
  render();
}
document.querySelectorAll("#viewMed .segb").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

/* ---------- referência ---------- */
$("#refPreset").addEventListener("change", e => {
  const v = e.target.value;
  if (v === "marker") $("#refLen").value = marker ? (marker.mm / 1000).toString() : "0.14";
  else if (v) $("#refLen").value = v;
  else { $("#refLen").focus(); $("#refLen").select(); }
  refresh();
});
$("#refLen").addEventListener("input", refresh);
const refLen = () => { const v = parseFloat($("#refLen").value); return v > 0 ? v : NaN; };

/* ---------- homografia (4 cantos do marcador -> quadrado de lado 1) ---------- */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
function homography(src, dst) {
  // normaliza para não perder precisão com fotos grandes
  const mx = src.reduce((s, p) => s + p.x, 0) / 4, my = src.reduce((s, p) => s + p.y, 0) / 4;
  const sc = Math.max(...src.map(p => Math.hypot(p.x - mx, p.y - my))) || 1;
  const A = [], b = [];
  src.forEach((p, i) => {
    const x = (p.x - mx) / sc, y = (p.y - my) / sc, u = dst[i].x, v = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  });
  const h = solve(A, b);
  if (!h) return null;
  return p => {
    const x = (p.x - mx) / sc, y = (p.y - my) / sc;
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

/* Transformação afim por mínimos quadrados (corrige giro, escala e foto um pouco de lado).
   É bem mais estável que a homografia quando a medida fica longe do marcador. */
function affine(src, dst) {
  const mx = src.reduce((s, p) => s + p.x, 0) / src.length, my = src.reduce((s, p) => s + p.y, 0) / src.length;
  const sc = Math.max(...src.map(p => Math.hypot(p.x - mx, p.y - my))) || 1;
  const P = src.map(p => [(p.x - mx) / sc, (p.y - my) / sc, 1]);
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
  P.forEach((r, i) => {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) N[a][b] += r[a] * r[b];
      bu[a] += r[a] * dst[i].x; bv[a] += r[a] * dst[i].y;
    }
  });
  const U = solve(N.map(r => r.slice()), bu), V = solve(N.map(r => r.slice()), bv);
  if (!U || !V) return null;
  return p => {
    const x = (p.x - mx) / sc, y = (p.y - my) / sc;
    return { x: U[0] * x + U[1] * y + U[2], y: V[0] * x + V[1] * y + V[2] };
  };
}
/* Quanto os lados opostos do marcador diferem (0 = foto de frente). */
function perspectiveStrength(c) {
  const L = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const r1 = L(c[0], c[1]) / L(c[3], c[2]), r2 = L(c[0], c[3]) / L(c[1], c[2]);
  return Math.max(Math.abs(Math.log(r1)), Math.abs(Math.log(r2)));
}

/* ---------- medidas ---------- */
const dist = l => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
function lenOf(l) {
  const L = refLen();
  if (!isFinite(L)) return NaN;
  if (marker) {
    const A = marker.H(l.a), B = marker.H(l.b);
    return Math.hypot(A.x - B.x, A.y - B.y) * L;
  }
  const r = lines.find(x => x.type === "ref");
  if (!r || dist(r) < 2) return NaN;
  return dist(l) * L / dist(r);
}
function tiltDeg(l) {
  return Math.atan2(Math.abs(l.b.x - l.a.x), Math.abs(l.b.y - l.a.y)) * 180 / Math.PI;
}
function valueOf(l) {
  if (l.type === "ref") return "Ref. " + num(refLen() || 0) + " m";
  if (l.type === "ang") return Math.round(tiltDeg(l)) + "° da vertical";
  const v = lenOf(l);
  return isFinite(v) ? "≈ " + num(v) + " m" : "marque a referência";
}

/* ---------- foto ---------- */
function setImage(src, preset) {
  const im = new Image();
  im.onload = () => {
    img = im; iw = im.naturalWidth; ih = im.naturalHeight;
    lines = preset ? preset() : [];
    pending = null; marker = null;
    buildGray();
    layout(); refresh();
    findMarker();
  };
  im.onerror = () => status("Não consegui abrir esta imagem. Tente outra foto.", "warn");
  im.src = src;
}
function onPhoto(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  setImage(URL.createObjectURL(f));
  setMode("ref");
  e.target.value = "";
}
$("#photoIn").addEventListener("change", onPhoto);
$("#cameraIn").addEventListener("change", onPhoto);

function status(text, kind) {
  const el = $("#markerMsg");
  el.hidden = !text; el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

/* ---------- marcador impresso ---------- */
function findMarker() {
  const token = ++detectToken;
  if (typeof jsQR !== "function") { status("Leitor do marcador não carregou (sem internet?). Use a referência manual.", "warn"); return; }
  status("Procurando o marcador impresso na foto…");
  const sizes = [...new Set([1400, 2200, 3200].map(s => Math.min(s, Math.max(iw, ih))))];
  const tmp = document.createElement("canvas"), t = tmp.getContext("2d", { willReadFrequently: true });
  let i = 0;
  const step = () => {
    if (token !== detectToken) return;
    if (i >= sizes.length) {
      status("Marcador não encontrado. Marque a referência manualmente (porta, A4, trena) ou tire a foto mais perto do marcador.", "warn");
      return;
    }
    const k = sizes[i++] / Math.max(iw, ih);
    const w = Math.round(iw * k), h = Math.round(ih * k);
    tmp.width = w; tmp.height = h;
    t.drawImage(img, 0, 0, w, h);
    let code = null;
    try { code = jsQR(t.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" }); } catch (err) {}
    const m = code && /^CM:(\d{2,4})$/.exec(code.data);
    if (m) {
      const L = code.location, sc = 1 / k;
      let corners = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].map(p => ({ x: p.x * sc, y: p.y * sc }));
      corners = refineCorners(corners) || corners;
      const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
      const strong = perspectiveStrength(corners) > 0.08; // lados opostos diferem mais de ~8%
      const H = strong ? homography(corners, sq) : affine(corners, sq);
      if (H) { setMarker(corners, H, +m[1], strong); return; }
    }
    setTimeout(step, 30);
  };
  setTimeout(step, 30);
}
/* Lê de novo só o pedaço da foto em volta do marcador, em resolução cheia (ampliado se for pequeno),
   para os cantos ficarem precisos mesmo quando o marcador ocupa poucos pixels. */
function refineCorners(c) {
  const xs = c.map(p => p.x), ys = c.map(p => p.y);
  const w0 = Math.max(...xs) - Math.min(...xs), h0 = Math.max(...ys) - Math.min(...ys);
  const pad = Math.max(w0, h0) * 0.6;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad)), y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const x1 = Math.min(iw, Math.ceil(Math.max(...xs) + pad)), y1 = Math.min(ih, Math.ceil(Math.max(...ys) + pad));
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 8 || ch < 8) return null;
  const u = Math.min(8, Math.max(1, 480 / Math.max(cw, ch)));
  const W = Math.round(cw * u), H = Math.round(ch * u);
  const t = document.createElement("canvas"); t.width = W; t.height = H;
  const tc = t.getContext("2d", { willReadFrequently: true });
  tc.imageSmoothingEnabled = u < 2;
  tc.drawImage(img, x0, y0, cw, ch, 0, 0, W, H);
  let code = null;
  try { code = jsQR(tc.getImageData(0, 0, W, H).data, W, H, { inversionAttempts: "dontInvert" }); } catch (e) {}
  if (!code || !/^CM:\d{2,4}$/.test(code.data)) return null;
  const L = code.location;
  return [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].map(p => ({ x: x0 + p.x / u, y: y0 + p.y / u }));
}

function setMarker(corners, H, mm, strong) {
  marker = { corners, H, mm };
  lines = lines.filter(l => l.type !== "ref");
  $("#refPreset").value = "marker";
  $("#refLen").value = (mm / 1000).toString();
  const side = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  let msg = `Marcador encontrado (${num(mm / 10, 0)} cm). Agora toque nas pontas do que quer medir.`;
  if (strong) msg += " A foto está bem de lado: corrigi a perspectiva, mas medidas longe do marcador podem errar. Se der, tire mais de frente.";
  else if (side < 60) msg += " O marcador ficou pequeno na foto: chegue mais perto ou use zoom para a medida ficar mais precisa.";
  status(msg, strong ? "warn" : "ok");
  if (mode === "ref") setMode("len");
  refresh();
}

$("#btnExample").addEventListener("click", () => {
  setImage(exampleImage(), () => [
    { type: "ref", a: { x: 532, y: 840 }, b: { x: 532, y: 1680 } },
    { type: "len", a: { x: 2020, y: 1680 }, b: { x: 2020, y: 720 } },
    { type: "ang", a: { x: 1706, y: 617 }, b: { x: 1756, y: 852 } }
  ]);
});

/* Desenho de exemplo: vista de lado, 400 px por metro. Porta de 2,10 m, marcador de 14 cm colado na parede
   e caixa num pedestal, centro a 2,40 m do chão, inclinada 12° para baixo. */
function exampleImage() {
  const c = document.createElement("canvas"); c.width = 2400; c.height = 1800;
  const x = c.getContext("2d");
  x.scale(2, 2); // coordenadas abaixo em 200 px/m
  const wall = x.createLinearGradient(0, 0, 0, 840); wall.addColorStop(0, "#d9d3c7"); wall.addColorStop(1, "#c9c1b2");
  x.fillStyle = wall; x.fillRect(0, 0, 1200, 840);
  x.fillStyle = "#8a6f55"; x.fillRect(0, 840, 1200, 60);
  x.fillStyle = "#7a5a3c"; x.fillRect(100, 420, 166, 420);
  x.fillStyle = "#6a4c31"; x.fillRect(114, 434, 138, 180); x.fillRect(114, 630, 138, 196);
  x.fillStyle = "#d8b25a"; x.beginPath(); x.arc(240, 640, 7, 0, 7); x.fill();
  x.fillStyle = "#3a3d40"; x.fillRect(1004, 380, 12, 460); x.fillRect(960, 830, 100, 10);
  x.save(); x.translate(900, 360); x.rotate(-12 * Math.PI / 180);
  x.fillStyle = "#24282b"; x.fillRect(-35, -60, 70, 120);
  x.fillStyle = "#15181a"; x.fillRect(-35, -60, 10, 120);
  x.restore();
  x.strokeStyle = "#3a3d40"; x.lineWidth = 8; x.beginPath(); x.moveTo(930, 362); x.lineTo(1010, 380); x.stroke();
  // folha A4 com o marcador
  x.fillStyle = "#fbfbf8"; x.fillRect(470, 470, 42, 59.4);
  x.fillStyle = "#5c5348"; x.font = "600 26px system-ui, sans-serif"; x.fillText("EXEMPLO · vista de lado", 40, 60);
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (typeof qrcode === "function") {
    const q = qrcode(1, "M"); q.addData("CM:140"); q.make();
    const n = q.getModuleCount(), size = 56, m = size / n, ox = 954, oy = 966; // 0,14 m = 56 px
    x.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) x.fillRect(ox + col * m, oy + r * m, m + 0.3, m + 0.3);
  }
  return c.toDataURL("image/png");
}

/* ---------- cinza para grudar na borda ---------- */
function buildGray() {
  gk = Math.min(1, 2000 / Math.max(iw, ih));
  gw = Math.round(iw * gk); gh = Math.round(ih * gk);
  const t = document.createElement("canvas"); t.width = gw; t.height = gh;
  const tc = t.getContext("2d", { willReadFrequently: true });
  tc.drawImage(img, 0, 0, gw, gh);
  const d = tc.getImageData(0, 0, gw, gh).data;
  gray = new Float32Array(gw * gh);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
}
function edgeAt(x, y) {
  const G = (xx, yy) => gray[yy * gw + xx];
  const gx = G(x + 1, y - 1) + 2 * G(x + 1, y) + G(x + 1, y + 1) - G(x - 1, y - 1) - 2 * G(x - 1, y) - G(x - 1, y + 1);
  const gy = G(x - 1, y + 1) + 2 * G(x, y + 1) + G(x + 1, y + 1) - G(x - 1, y - 1) - 2 * G(x, y - 1) - G(x + 1, y - 1);
  return Math.hypot(gx, gy);
}
function snap(pt) {
  if (!gray || !$("#snapOn").checked) return;
  const cx = Math.round(pt.x * gk), cy = Math.round(pt.y * gk);
  const r = Math.max(3, Math.round(14 / scale * gk)); // ~14 px de tela em volta do dedo
  let best = 0, bx = cx, by = cy, sum = 0, n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 1 || y >= gh - 1) continue;
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || x >= gw - 1) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const m = edgeAt(x, y);
      sum += m; n++;
      const score = m * (1 - 0.45 * d / r);
      if (score > best) { best = score; bx = x; by = y; }
    }
  }
  if (n && best > 40 && best > 2.2 * (sum / n)) { pt.x = bx / gk; pt.y = by / gk; }
}

/* ---------- desenho ---------- */
function layout() {
  if (!img || $("#viewMed").hidden) return;
  cv.hidden = false; $("#photoEmpty").hidden = true;
  const boxW = cv.parentElement.clientWidth;
  if (!boxW) return;
  const maxH = Math.max(260, window.innerHeight * 0.7);
  scale = Math.min(boxW / iw, maxH / ih);
  const w = Math.round(iw * scale), h = Math.round(ih * scale);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.style.width = w + "px"; cv.style.height = h + "px";
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  C = { ref: css("--trace"), len: css("--amber"), ang: css("--ok"), fg: css("--fg"), font: css("--f-mono") };
  render();
}
window.addEventListener("resize", layout);

function pill(text, x, y, color) {
  g.font = `600 13px ${C.font}`;
  const w = g.measureText(text).width + 12, h = 22;
  const cw = cv.width / dpr, ch = cv.height / dpr;
  const px = Math.min(cw - w - 2, Math.max(2, x - w / 2)), py = Math.min(ch - h - 2, Math.max(2, y - h - 10));
  g.fillStyle = "rgba(10,13,14,.85)"; g.fillRect(px, py, w, h);
  g.strokeStyle = color; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, w - 1, h - 1);
  g.fillStyle = color; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(text, px + 6, py + h / 2 + 1);
}
function dot(p, color) {
  g.beginPath(); g.arc(p.x * scale, p.y * scale, 7, 0, Math.PI * 2);
  g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke();
}
function render() {
  if (!img || cv.hidden || !cv.width) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.drawImage(img, 0, 0, iw * scale, ih * scale);
  if (marker) {
    const c = marker.corners;
    g.beginPath(); c.forEach((p, i) => i ? g.lineTo(p.x * scale, p.y * scale) : g.moveTo(p.x * scale, p.y * scale)); g.closePath();
    g.lineWidth = 3; g.strokeStyle = C.ref; g.stroke();
    pill("Marcador " + num(refLen() * 100, 1) + " cm", c[0].x * scale + (c[1].x - c[0].x) * scale / 2, Math.min(c[0].y, c[1].y) * scale, C.ref);
  }
  for (const l of lines) {
    const col = C[l.type];
    g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(l.a.x * scale, l.a.y * scale); g.lineTo(l.b.x * scale, l.b.y * scale); g.stroke();
    g.strokeStyle = col; g.lineWidth = 3; g.stroke();
    dot(l.a, col); dot(l.b, col);
    pill(valueOf(l), (l.a.x + l.b.x) / 2 * scale, (l.a.y + l.b.y) / 2 * scale, col);
  }
  if (pending) dot(pending.a, C[pending.type]);
  if (drag) loupe(drag.pt);
}
function loupe(p) {
  const R = 62, Z = 3, cw = cv.width / dpr;
  const sx = p.x * scale;
  const cx = sx > cw / 2 ? R + 8 : cw - R - 8, cy = R + 8;
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.closePath();
  g.fillStyle = "#000"; g.fill(); g.clip();
  const src = R / Z / scale;
  g.drawImage(img, p.x - src, p.y - src, src * 2, src * 2, cx - R, cy - R, R * 2, R * 2);
  g.strokeStyle = "#fff"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  g.restore();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = C.fg; g.lineWidth = 2; g.stroke();
}

/* ---------- toque e arraste ---------- */
function toImg(e) {
  const r = cv.getBoundingClientRect();
  return { x: Math.max(0, Math.min(iw, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(ih, (e.clientY - r.top) / scale)) };
}
cv.addEventListener("pointerdown", e => {
  if (!img) return;
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  const p = toImg(e), hit = 22 / scale;
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const k of ["a", "b"]) {
      const q = lines[i][k];
      if (Math.hypot(q.x - p.x, q.y - p.y) < hit) { drag = { pt: q }; render(); return; }
    }
  }
  if (pending && pending.type === mode) {
    const l = { type: mode, a: pending.a, b: p };
    if (mode === "ref") { lines = lines.filter(x => x.type !== "ref"); marker = null; if ($("#refPreset").value === "marker") { $("#refPreset").value = "2.10"; $("#refLen").value = "2.10"; } status(""); }
    lines.push(l); pending = null; drag = { pt: l.b };
  } else {
    pending = { type: mode, a: p }; drag = { pt: pending.a };
  }
  render(); refresh();
});
cv.addEventListener("pointermove", e => {
  if (!drag) return;
  const p = toImg(e); drag.pt.x = p.x; drag.pt.y = p.y;
  render(); refresh();
});
const endDrag = () => { if (drag) { snap(drag.pt); drag = null; render(); refresh(); } };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

/* ---------- lista ---------- */
const NAMES = { ref: "Referência", len: "Medida", ang: "Inclinação" };
function refresh() {
  const ul = $("#lines"); ul.textContent = "";
  if (!lines.length) {
    const li = document.createElement("li"); li.className = "empty";
    li.textContent = !img ? "Nenhuma medida ainda." : marker ? "Escolha Medir e toque nas duas pontas do que quer medir." : "Marque a referência: porta, folha A4 ou trena.";
    ul.append(li);
  }
  const count = { ref: 0, len: 0, ang: 0 };
  lines.forEach((l, i) => {
    count[l.type]++;
    const li = document.createElement("li");
    li.innerHTML = `<span class="sw"></span><span></span><span class="lv"></span><span></span><button class="del" aria-label="Apagar">×</button>`;
    li.children[0].style.background = `var(--${l.type === "ref" ? "trace" : l.type === "len" ? "amber" : "ok"})`;
    li.children[1].textContent = NAMES[l.type] + (l.type === "ref" ? "" : " " + count[l.type]);
    li.children[2].textContent = valueOf(l);
    if (l.type !== "ref") {
      const b = document.createElement("button");
      b.className = "use";
      if (l.type === "ang") { b.textContent = "Usar"; b.title = "Usar como inclinação nas Contas rápidas"; b.onclick = () => setCalc("cTilt", Math.round(tiltDeg(l)), "Inclinação"); }
      else { b.textContent = "Altura"; b.title = "Usar como altura da caixa nas Contas rápidas"; b.onclick = () => { const v = lenOf(l); if (isFinite(v)) setCalc("cH", v, "Altura da caixa"); }; }
      li.children[3].append(b);
    }
    li.children[4].addEventListener("click", () => { lines.splice(i, 1); render(); refresh(); });
    ul.append(li);
  });
  render();
}
$("#btnClearLines").addEventListener("click", () => { lines = []; pending = null; render(); refresh(); });

setMode("ref");
refresh();
})();
