const PIE_COLORS = {
  noIndiceNotBlocking: "#004990", // bleu
  noIndiceBlocking: "#ed1b2d",    // rouge
  withIndice: "#808080"           // gris (3e couleur)
};

// hit-test (clic sur les parts)
window.PIE_HIT = {
  cx: 0, cy: 0, r: 110,
  start: -Math.PI / 2,
  slices: [] // [{key,start,end}]
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

  title.textContent = project ? `SUIVI INDICE — ${project}` : "SUIVI INDICE";

  // Texte à droite
  if (!project) {
    numbers.textContent = "Sélectionne un projet";
  } else if (total === 0) {
    numbers.textContent = "Aucune ligne sur ce projet/document.";
  } else {
    numbers.innerHTML = `
      <div><b>Total lignes :</b> ${total}</div>
      <div>• Sans Indice (non bloquant) : ${countNoIndiceNotBlocking}</div>
      <div>• Sans Indice (bloquant) : ${countNoIndiceBlocking}</div>
      <div>• Avec Indice : ${countWithIndice}</div>
      <div style="margin-top:6px; font-size:12px;">
        Clic sur une couleur pour filtrer la liste.
      </div>
    `;
  }

  // Légende (cliquable)
  legend.innerHTML = `
    <div class="legend-item ${activeSlice === "NO_INDICE_NOT_BLOCKING" ? "active" : ""}" data-slice="NO_INDICE_NOT_BLOCKING">
      <span class="legend-swatch" style="background:${PIE_COLORS.noIndiceNotBlocking}"></span>
      Sans Indice (non bloquant)
    </div>
    <div class="legend-item ${activeSlice === "NO_INDICE_BLOCKING" ? "active" : ""}" data-slice="NO_INDICE_BLOCKING">
      <span class="legend-swatch" style="background:${PIE_COLORS.noIndiceBlocking}; border-color:#ed1b2d;"></span>
      Sans Indice (bloquant)
    </div>
    <div class="legend-item ${activeSlice === "WITH_INDICE" ? "active" : ""}" data-slice="WITH_INDICE">
      <span class="legend-swatch" style="background:${PIE_COLORS.withIndice}; border-color:#808080;"></span>
      Avec Indice (autres)
    </div>
  `;

  // Préparer hit-test
  window.PIE_HIT.cx = canvas.width / 2;
  window.PIE_HIT.cy = canvas.height / 2;
  window.PIE_HIT.r = 110;
  window.PIE_HIT.start = -Math.PI / 2;
  window.PIE_HIT.slices = [];

  // Nettoyer / dessiner
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!project || total === 0) {
    ctx.beginPath();
    ctx.arc(window.PIE_HIT.cx, window.PIE_HIT.cy, window.PIE_HIT.r, 0, Math.PI * 2);
    ctx.strokeStyle = "#ed1b2d";
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }

  // Construire slices dans un ordre fixe (bleu -> rouge -> gris)
  const data = [
    { key: "NO_INDICE_NOT_BLOCKING", value: countNoIndiceNotBlocking, color: PIE_COLORS.noIndiceNotBlocking },
    { key: "NO_INDICE_BLOCKING", value: countNoIndiceBlocking, color: PIE_COLORS.noIndiceBlocking },
    { key: "WITH_INDICE", value: countWithIndice, color: PIE_COLORS.withIndice },
  ];

  let start = window.PIE_HIT.start;

  for (const s of data) {
    if (s.value <= 0) continue;

    const angle = (s.value / total) * Math.PI * 2;
    const end = start + angle;

    // enregistrer pour clic
    window.PIE_HIT.slices.push({ key: s.key, start, end });

    // dessiner (pop si actif)
    drawSlice(ctx, start, end, s.color, activeSlice === s.key);

    start = end;
  }

  // contour
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

  // Convertir en angle relatif, aligné sur "start"
  let rel = ang - window.PIE_HIT.start;
  while (rel < 0) rel += Math.PI * 2;
  while (rel >= Math.PI * 2) rel -= Math.PI * 2;

  // retrouver slice correspondant
  const abs = rel + window.PIE_HIT.start;
  for (const s of window.PIE_HIT.slices) {
    if (abs >= s.start && abs < s.end) return s.key;
  }
  return null;
}

/* -------- Table -------- */

function renderDetailsTable({ rows, title, footer }) {
  const tTitle = document.getElementById("detailsTitle");
  const tbody = document.getElementById("detailsTbody");
  const tFooter = document.getElementById("detailsFooter");

  tTitle.textContent = title || "Lignes";
  tFooter.textContent = footer || "";

  tbody.innerHTML = rows.map(r => {
    // Ligne “séparateur” de groupe
    if (r.type === "group") {
        return `
            <tr class="group-row">
                <td colspan="6">
                    <span class="group-label">${escapeHtml(r.label)}</span>
                    <span class="group-count">(${r.count})</span>
                </td>
            </tr>
        `;
    }

    // Ligne “normale”
    return `
      <tr data-rowid="${r.rowId ?? ""}">
        <td>${escapeHtml(r.emetteur)}</td>
        <td>${escapeHtml(r.reference)}</td>
        <td>${escapeHtml(r.indice)}</td>
        <td>${escapeHtml(r.recu)}</td>
        <td>${escapeHtml(r.observation)}</td>
        <td class="bloq-cell">${r.bloquant ? "✓" : ""}</td>
      </tr>
    `;
  }).join("");
}
