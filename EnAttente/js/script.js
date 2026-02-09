const selectProjet = document.getElementById("selectProjet");
const selectDocument = document.getElementById("selectDocument");
const btnRefresh = document.getElementById("btnRefresh");

const AppState = {
  projet: "",
  document: "",
  filtered: []
};

function fillSelect(select, values, current) {
  select.innerHTML =
    `<option value="">-- Tous --</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

function compute() {
  const recs = GristData.records;

  const projets = uniqueSorted(recs.map(r => r.NomProjet));
  const docs = uniqueSorted(recs.map(r => r.NomDocument));

  fillSelect(selectProjet, projets, AppState.projet);
  fillSelect(selectDocument, docs, AppState.document);

  const p = AppState.projet;
  const d = AppState.document;

  AppState.filtered = recs.filter(r =>
    (!p || r.NomProjet === p) &&
    (!d || r.NomDocument === d)
  );

  renderUI(AppState);
}

selectProjet.addEventListener("change", () => {
  AppState.projet = selectProjet.value;
  compute();
});

selectDocument.addEventListener("change", () => {
  AppState.document = selectDocument.value;
  compute();
});

btnRefresh.addEventListener("click", () => compute());

initGrist(compute);
