const PIE_COLORS = {
  noIndiceNotBlocking: "#004990",
  noIndiceBlocking: "#ed1b2d",
  withIndice: "#808080"
};

function formatPercent(value, total) {
  if (!total || total <= 0 || !value || value <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

window.PIE_HIT = {
  cx: 0,
  cy: 0,
  r: 110,
  start: -Math.PI / 2,
  slices: []
};

function renderPieChart({
  project,
  countNoIndiceNotBlocking,
  countNoIndiceBlocking,
  countWithIndice,
  activeSlice
}) {
  const title = document.getElementById("chartTitle");
  const numbers = document.getElementById("chartNumbers");
  const legend = document.getElementById("legend");
  const canvas = document.getElementById("pieCanvas");
  const ctx = canvas.getContext("2d");

  canvas.style.cursor = "pointer";

  const total = countNoIndiceNotBlocking + countNoIndiceBlocking + countWithIndice;

  title.textContent = project ? `SUIVI INDICE - ${project}` : "SUIVI INDICE";

  if (!project) {
    numbers.textContent = "Choisir un projet";
  } else if (total === 0) {
    numbers.textContent = "Aucune ligne sur ce projet/document.";
  } else {
    numbers.innerHTML = `
      <div class="chart-metric"><b>Total lignes :</b><span>${total}</span></div>
      <div class="chart-metric"><span>Sans indice (non bloquant) :</span><b>${countNoIndiceNotBlocking}</b><span>(${formatPercent(countNoIndiceNotBlocking, total)})</span></div>
      <div class="chart-metric"><span>Sans indice (bloquant) :</span><b>${countNoIndiceBlocking}</b><span>(${formatPercent(countNoIndiceBlocking, total)})</span></div>
      <div class="chart-metric"><span>Avec indice :</span><b>${countWithIndice}</b><span>(${formatPercent(countWithIndice, total)})</span></div>
      <div class="chart-help">Clique sur une couleur pour filtrer la liste.</div>
    `;
  }

  legend.innerHTML = `
    <div class="legend-item ${activeSlice === "NO_INDICE_NOT_BLOCKING" ? "active" : ""}" data-slice="NO_INDICE_NOT_BLOCKING">
      <span class="legend-swatch" style="background:${PIE_COLORS.noIndiceNotBlocking}"></span>
      Sans indice (non bloquant)
    </div>
    <div class="legend-item ${activeSlice === "NO_INDICE_BLOCKING" ? "active" : ""}" data-slice="NO_INDICE_BLOCKING">
      <span class="legend-swatch" style="background:${PIE_COLORS.noIndiceBlocking}; border-color:#ed1b2d;"></span>
      Sans indice (bloquant)
    </div>
    <div class="legend-item ${activeSlice === "WITH_INDICE" ? "active" : ""}" data-slice="WITH_INDICE">
      <span class="legend-swatch" style="background:${PIE_COLORS.withIndice}; border-color:#808080;"></span>
      Avec indice
    </div>
  `;

  window.PIE_HIT.cx = canvas.width / 2;
  window.PIE_HIT.cy = canvas.height / 2;
  window.PIE_HIT.r = 110;
  window.PIE_HIT.start = -Math.PI / 2;
  window.PIE_HIT.slices = [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!project || total === 0) {
    ctx.beginPath();
    ctx.arc(window.PIE_HIT.cx, window.PIE_HIT.cy, window.PIE_HIT.r, 0, Math.PI * 2);
    ctx.strokeStyle = "#d6e0ea";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#627386";
    ctx.font = "600 13px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(project ? "Aucune ligne" : "Projet requis", window.PIE_HIT.cx, window.PIE_HIT.cy);
    return;
  }

  const data = [
    { key: "NO_INDICE_NOT_BLOCKING", value: countNoIndiceNotBlocking, color: PIE_COLORS.noIndiceNotBlocking },
    { key: "NO_INDICE_BLOCKING", value: countNoIndiceBlocking, color: PIE_COLORS.noIndiceBlocking },
    { key: "WITH_INDICE", value: countWithIndice, color: PIE_COLORS.withIndice }
  ];

  let start = window.PIE_HIT.start;

  for (const s of data) {
    if (s.value <= 0) continue;

    const angle = (s.value / total) * Math.PI * 2;
    const end = start + angle;

    window.PIE_HIT.slices.push({ key: s.key, start, end });
    drawSlice(ctx, start, end, s.color, activeSlice === s.key);
    drawSlicePercentLabel(ctx, start, end, s.value, total, activeSlice === s.key);

    start = end;
  }

  ctx.beginPath();
  ctx.arc(window.PIE_HIT.cx, window.PIE_HIT.cy, window.PIE_HIT.r, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawSlice(ctx, a0, a1, color, active) {
  const { cx, cy, r } = window.PIE_HIT;

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

function drawSlicePercentLabel(ctx, a0, a1, value, total, active) {
  const { cx, cy, r } = window.PIE_HIT;
  const percentText = formatPercent(value, total);
  const mid = (a0 + a1) / 2;
  const sliceAngle = a1 - a0;
  const offset = active ? 8 : 0;
  const dx = Math.cos(mid) * offset;
  const dy = Math.sin(mid) * offset;

  ctx.save();
  ctx.translate(dx, dy);
  ctx.font = "700 15px Segoe UI, Arial, sans-serif";
  ctx.textBaseline = "middle";

  if (sliceAngle >= 0.42) {
    const labelRadius = r * 0.62;
    const x = cx + Math.cos(mid) * labelRadius;
    const y = cy + Math.sin(mid) * labelRadius;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(percentText, x, y);
    ctx.restore();
    return;
  }

  const startRadius = r * 0.9;
  const endRadius = r + 16;
  const lineStartX = cx + Math.cos(mid) * startRadius;
  const lineStartY = cy + Math.sin(mid) * startRadius;
  const lineEndX = cx + Math.cos(mid) * endRadius;
  const lineEndY = cy + Math.sin(mid) * endRadius;
  const horizontalOffset = Math.cos(mid) >= 0 ? 18 : -18;
  const labelX = lineEndX + horizontalOffset;
  const labelY = lineEndY;

  ctx.strokeStyle = "#004990";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lineStartX, lineStartY);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.lineTo(labelX, labelY);
  ctx.stroke();

  ctx.textAlign = horizontalOffset > 0 ? "left" : "right";
  ctx.fillStyle = "#004990";
  ctx.fillText(percentText, labelX + (horizontalOffset > 0 ? 4 : -4), labelY);
  ctx.restore();
}

function hitTestPie(clientX, clientY) {
  const canvas = document.getElementById("pieCanvas");
  const rect = canvas.getBoundingClientRect();

  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);

  const dx = x - window.PIE_HIT.cx;
  const dy = y - window.PIE_HIT.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > window.PIE_HIT.r) return null;

  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += Math.PI * 2;

  let rel = ang - window.PIE_HIT.start;
  while (rel < 0) rel += Math.PI * 2;
  while (rel >= Math.PI * 2) rel -= Math.PI * 2;

  const abs = rel + window.PIE_HIT.start;
  for (const s of window.PIE_HIT.slices) {
    if (abs >= s.start && abs < s.end) return s.key;
  }
  return null;
}

function renderDetailsTable({ rows, title, footer }) {
  const tTitle = document.getElementById("detailsTitle");
  const tbody = document.getElementById("detailsTbody");
  const tFooter = document.getElementById("detailsFooter");

  tTitle.textContent = title || "Lignes";
  tFooter.textContent = footer || "";

  tbody.innerHTML = rows.map(r => {
    if (r.type === "group") {
      return `
        <tr class="group-row">
          <td colspan="6">
            <span class="group-label">${escapeHtml(r.label)}</span>
            <span class="group-count">(${r.count} sur ${r.totalCount ?? r.count})</span>
          </td>
        </tr>
      `;
    }

    return `
      <tr data-rowid="${r.rowId ?? ""}">
        <td>${escapeHtml(r.emetteur)}</td>
        <td>${escapeHtml(r.reference)}</td>
        <td>${escapeHtml(r.indice)}</td>
        <td>${escapeHtml(r.recu)}</td>
        <td>${escapeHtml(r.observation)}</td>
        <td class="bloq-cell">${r.bloquant ? "&#10003;" : ""}</td>
      </tr>
    `;
  }).join("");
}
