function renderUI(state) {
  const status = document.getElementById("status");
  const content = document.getElementById("content");

  status.textContent = `${state.filtered.length} ligne(s)`;

  content.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Référence</th>
          <th>Indice</th>
          <th>Emetteur</th>
        </tr>
      </thead>
      <tbody>
        ${state.filtered.slice(0, 80).map(r => `
          <tr>
            <td>${escapeHtml(r.Reference)}</td>
            <td><span class="badge">${escapeHtml(r.Indice)}</span></td>
            <td>${escapeHtml(r.Emetteur)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}
