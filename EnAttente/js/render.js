const PIE_COLORS = {
  notBlocking: "#004990", // bleu (DA Reference2)
  blocking: "#ed1b2d"     // rouge
};

function renderPieChart({ project, countNotBlocking, countBlocking }) {
  const title = document.getElementById("chartTitle");
  const numbers = document.getElementById("chartNumbers");
  const legend = document.getElementById("legend");
  const canvas = document.getElementById("pieCanvas");
  const ctx = canvas.getContext("2d");

  const total = countNotBlocking + countBlocking;

  title.textContent = project ? `EN ATTENTE — ${project}` : "EN ATTENTE";

  // Texte
  if (!project) {
    numbers.textContent = "Sélectionne un projet";
  } else if (total === 0) {
    numbers.textContent = "Aucun élément 'EN ATTENTE' sur ce projet.";
  } else {
    const p1 = Math.round((countNotBlocking / total) * 100);
    const p2 = 100 - p1;
    numbers.innerHTML = `
      <div><b>Total EN ATTENTE :</b> ${total}</div>
      <div>• EN ATTENTE non bloquant : ${countNotBlocking} (${p1}%)</div>
      <div>• EN ATTENTE bloquant : ${countBlocking} (${p2}%)</div>
    `;
  }

  // Légende
  legend.innerHTML = `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${PIE_COLORS.notBlocking}"></span>
      EN ATTENTE (non bloquant)
    </div>
    <div class="legend-item">
      <span class="legend-swatch" style="background:${PIE_COLORS.blocking}; border-color:#ed1b2d;"></span>
      EN ATTENTE (bloquant)
    </div>
  `;

  // Dessin
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Si rien à afficher => petit cercle vide
  if (!project || total === 0) {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 90, 0, Math.PI * 2);
    ctx.strokeStyle = "#ed1b2d";
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 110;

  let start = -Math.PI / 2;

  // Part 1 : non bloquant
  const angle1 = (countNotBlocking / total) * Math.PI * 2;
  drawSlice(ctx, centerX, centerY, radius, start, start + angle1, PIE_COLORS.notBlocking);
  start += angle1;

  // Part 2 : bloquant
  const angle2 = (countBlocking / total) * Math.PI * 2;
  drawSlice(ctx, centerX, centerY, radius, start, start + angle2, PIE_COLORS.blocking);

  // petit contour
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawSlice(ctx, cx, cy, r, a0, a1, color) {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a0, a1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
