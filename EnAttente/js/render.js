const PIE_COLORS = {
  notBlocking: "#004990", // bleu
  blocking: "#ed1b2d"     // rouge
};

// modèle global pour le hit-test (clic sur slices)
window.PIE_HIT = {
  cx: 0, cy: 0, r: 0,
  start: -Math.PI / 2,
  aNot: 0,
  aBlock: 0
};

function renderPieChart({ project, countNotBlocking, countBlocking, activeSlice }) {
  const title = document.getElementById("chartTitle");
  const numbers = document.getElementById("chartNumbers");
  const legend = document.getElementById("legend");
  const canvas = document.getElementById("pieCanvas");
  const ctx = canvas.getContext("2d");

  canvas.style.cursor = "pointer";

  const total = countNotBlocking + countBlocking;

  title.textContent = project ? `EN ATTENTE — ${project}` : "EN ATTENTE";

  // Texte
  if (!project) {
    numbers.textContent = "Sélectionne un projet";
  } else if (total === 0) {
    numbers.textContent = "Aucun élément 'EN ATTENTE' sur ce projet/document.";
  } else {
    const p1 = Math.round((countNotBlocking / total) * 100);
    const p2 = 100 - p1;
    numbers.innerHTML = `
      <div><b>Total EN ATTENTE :</b> ${total}</div>
      <div>• EN ATTENTE non bloquant : ${countNotBlocking} (${p1}%)</div>
      <div>• EN ATTENTE bloquant : ${countBlocking} (${p2}%)</div>
      <div style="margin-top:6px; font-size:12px;">
        Clic sur une couleur pour filtrer la liste.
      </div>
    `;
  }

  // Légende cliquable
  const isActiveNot = activeSlice === "NOT_BLOCKING";
  const isActiveBlock = activeSlice === "BLOCKING";

  legend.innerHTML = `
    <div class="legend-item ${isActiveNot ? "active" : ""}" data-slice="NOT_BLOCKING">
      <span class="legend-swatch" style="background:${PIE_COLORS.notBlocking}"></span>
      EN ATTENTE (non bloquant)
    </div>
    <div class="legend-item ${isActiveBlock ? "active" : ""}" data-slice="BLOCKING">
      <span class="legend-swatch" style="background:${PIE_COLORS.blocking}; border-color:#ed1b2d;"></span>
      EN ATTENTE (bloquant)
    </div>
  `;

  // modèle hit-test
  window.PIE_HIT.cx = canvas.width / 2;
  window.PIE_HIT.cy = canvas.height / 2;
  window.PIE_HIT.r = 110;
  window.PIE_HIT.start = -Math.PI / 2;

  window.PIE_HIT.aNot = total ? (countNotBlocking / total) * Math.PI * 2 : 0;
  window.PIE_HIT.aBlock = total ? (countBlocking / total) * Math.PI * 2 : 0;

  // Dessin
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!project || total === 0) {
    ctx.beginPath();
    ctx.arc(window.PIE_HIT.cx, window.PIE_HIT.cy, window.PIE_HIT.r, 0, Math.PI * 2);
    ctx.strokeStyle = "#ed1b2d";
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }

  let start = window.PIE_HIT.start;

  // non-bloquant
  const a1 = window.PIE_HIT.aNot;
  drawSlice(ctx, start, start + a1, PIE_COLORS.notBlocking, isActiveNot);
  start += a1;

  // bloquant
  const a2 = window.PIE_HIT.aBlock;
  drawSlice(ctx, start, start + a2, PIE_COLORS.blocking, isActiveBlock);

  // contour
  ctx.beginPath();
  ctx.arc(window.PIE_HIT.cx, window.PIE_HIT.cy, window.PIE_HIT.r, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawSlice(ctx, a0, a1, color, active) {
  const { cx, cy, r } = window.PIE_HIT;

  // petit “pop” si actif
  const offset = active ? 8 : 0;
  const mid = (a0 + a1) / 2;
  const dx = Math.cos(mid) * offset;
  const dy = Math.sin(mid) * offset;

  ctx.save();
  ctx.translate(dx, dy);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a0, a1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  if (active) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.restore();
}

function hitTestPie(clientX, clientY) {
  const canvas = document.getElementById("pieCanvas");
  const rect = canvas.getBoundingClientRect();

  // coords canvas
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);

  const dx = x - window.PIE_HIT.cx;
  const dy = y - window.PIE_HIT.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > window.PIE_HIT.r) return null;

  // angle 0..2pi
  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += Math.PI * 2;

  // normaliser par rapport au start
  let rel = ang - window.PIE_HIT.start;
  while (rel < 0) rel += Math.PI * 2;
  while (rel >= Math.PI * 2) rel -= Math.PI * 2;

  const aNot = window.PIE_HIT.aNot;

  if (aNot > 0 && rel < aNot) return "NOT_BLOCKING";
  if (window.PIE_HIT.aBlock > 0) return "BLOCKING";

  return null;
}

function renderDetailsTable({ rows, title, footer }) {
  const tTitle = document.getElementById("detailsTitle");
  const tbody = document.getElementById("detailsTbody");
  const tFooter = document.getElementById("detailsFooter");

  tTitle.textContent = title || "Lignes EN ATTENTE";
  tFooter.textContent = footer || "";

  tbody.innerHTML = rows.map(r => `
    <tr data-rowid="${r.rowId ?? ""}">
      <td>${escapeHtml(r.emetteur)}</td>
      <td>${escapeHtml(r.reference)}</td>
      <td>${escapeHtml(r.indice)}</td>
      <td>${escapeHtml(r.recu)}</td>
      <td>${escapeHtml(r.observation)}</td>
      <td class="bloq-cell">${r.bloquant ? "✓" : ""}</td>
    </tr>
  `).join("");
}
