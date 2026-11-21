/* Caça-Microfonia — coisas usadas por todas as abas: navegação, aviso rápido e envio de números para as Contas rápidas. */
"use strict";
window.CM = (() => {
  const $ = s => document.querySelector(s);
  const num = (v, d = 2) => Number(v).toFixed(d).replace(".", ",");
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* abas: #medir e #caixas na URL, sem nada = Microfonia */
  const VIEWS = { mic: ["#viewMic", "#tabMic", ""], medir: ["#viewMed", "#tabMed", "medir"], caixas: ["#viewCx", "#tabCx", "caixas"], planta: ["#viewPl", "#tabPl", "planta"] };
  function show(name) {
    if (!VIEWS[name]) name = "mic";
    for (const [k, [view, tab]] of Object.entries(VIEWS)) {
      $(view).hidden = k !== name;
      $(tab).setAttribute("aria-selected", String(k === name));
    }
    // as telas com canvas recalculam o tamanho quando aparecem
    window.dispatchEvent(new Event("resize"));
  }
  const fromHash = () => { const h = location.hash.slice(1); return VIEWS[h] && h !== "mic" ? h : "mic"; };
  for (const [k, [, tab, hash]] of Object.entries(VIEWS)) {
    $(tab).addEventListener("click", () => {
      if (hash) location.hash = hash; else history.replaceState(null, "", location.pathname + location.search);
      show(k);
    });
  }
  window.addEventListener("hashchange", () => show(fromHash()));

  let toastTimer = 0;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* coloca um número num campo das Contas rápidas e recalcula */
  function setCalc(id, value, label) {
    const el = document.getElementById(id);
    if (!el || !isFinite(value)) return;
    el.value = (Math.round(value * 100) / 100).toString();
    el.dispatchEvent(new Event("input"));
    toast(`${label} enviado para Contas rápidas (aba Caixas)`);
  }

  /* seletor "→ Planta": manda um número em metros para um campo da aba Planta (usado na foto, no AR e nos passos) */
  const PLAN_FIELDS = [
    ["L", "Comprimento da igreja"], ["W", "Largura da nave"], ["Hc", "Altura do teto"],
    ["Ps", "Profundidade do palco"], ["Hs", "Altura do palco"], ["D1", "Palco até a 1ª fileira"],
    ["Mic", "Microfones atrás da borda do palco"],
    ["Hg", "Altura da galeria"], ["Dg", "Quanto a galeria avança"], ["Mur", "Altura da mureta"],
    ["Sh", "Altura da caixa"], ["Sw", "Caixa até a parede lateral"], ["Sx", "Caixa à frente do palco"]
  ];
  function planSelect(getVal) {
    const s = document.createElement("select");
    s.className = "planSel"; s.setAttribute("aria-label", "Enviar esta medida para a aba Planta");
    s.innerHTML = '<option value="">→ Planta…</option>' + PLAN_FIELDS.map(([id, t]) => `<option value="${id}">${t}</option>`).join("");
    s.addEventListener("change", () => {
      const id = s.value; s.value = "";
      if (!id) return;
      const v = getVal();
      if (!isFinite(v)) { toast("Ainda não há medida para enviar"); return; }
      const label = PLAN_FIELDS.find(f => f[0] === id)[1];
      if (window.CM.setPlan) { window.CM.setPlan(id, v); toast(`${label}: ${num(v)} m, enviado para a aba Planta`); }
    });
    return s;
  }

  document.addEventListener("DOMContentLoaded", () => show(fromHash()));
  if (document.readyState !== "loading") setTimeout(() => show(fromHash()));

  return { $, num, css, toast, setCalc, show, planSelect };
})();
