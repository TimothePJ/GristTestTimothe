let selectedFirstValue = '';
let selectedDocName = '';
let selectedDocNumber = null;
let lastValidDocumentValue = '';

const firstDropdown = document.getElementById('firstColumnDropdown');
const secondDropdown = document.getElementById('secondColumnListbox');

function populateFirstColumnDropdown(values) {
  // Conserve la sélection actuelle
  const currentSelection = firstDropdown.value;

  values.sort((a, b) => a.localeCompare(b));

  firstDropdown.innerHTML = '<option value="">Selectionner un projet</option>';

  values.forEach(value => {
    if (value) {
      const option = document.createElement('option');
      option.value = value;
      option.text = value;
      firstDropdown.appendChild(option);
    }
  });

  firstDropdown.value = currentSelection || '';
}

function populateSecondColumnListbox(selectedProject) {
  // Reset
  secondDropdown.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.text = 'Sélectionner un document';
  secondDropdown.appendChild(placeholder);

  // Build unique (NomDocument, NumeroDocument) pairs like Reference2
  const map = new Map(); // NomDocument -> Set(num|null)

  (App.records || []).forEach(record => {
    if (!record) return;
    if (record.NomProjet !== selectedProject) return;

    const name = String(record.NomDocument || '').trim();
    if (!name) return;

    const num = normalizeNumero(record.NumeroDocument);

    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(num);
  });

  // Build sorted options
  const opts = [];
  for (const [name, setNums] of map.entries()) {
    const nums = Array.from(setNums);
    nums.sort((a, b) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    });

    nums.forEach(n => {
      const value = JSON.stringify({ name: name, n: (n == null ? null : Number(n)) });
      const label = makeDocLabel(name, n);
      opts.push({ value, label, name, n });
    });
  }

  // Global sort: numero asc (null last), then name
  opts.sort((a, b) => {
    const an = a.n == null ? Infinity : a.n;
    const bn = b.n == null ? Infinity : b.n;
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });

  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    secondDropdown.appendChild(opt);
  }

  // Special actions (comme Reference2)
  const addOption = document.createElement('option');
  addOption.value = 'addTable';
  addOption.text = 'Ajouter document';
  secondDropdown.appendChild(addOption);

  const addMultipleOption = document.createElement('option');
  addMultipleOption.value = 'addMultipleTable';
  addMultipleOption.text = 'Ajouter Plusieurs document';
  secondDropdown.appendChild(addMultipleOption);
}

/* 1) Quand Grist envoie les records => remplir le dropdown projet */
function onDataUpdate() {
  const projects = uniqProjects(App.records);
  populateFirstColumnDropdown(projects);

  // si un projet est déjà sélectionné, on garde la cohérence du 2e dropdown
  const currentProject = firstDropdown.value.trim();
  if (currentProject) {
    secondDropdown.disabled = false;
    populateSecondColumnListbox(currentProject);
  } else {
    secondDropdown.disabled = true;
  }
}

/* 2) Change Projet => reset + recharge documents */
firstDropdown.addEventListener('change', function() {
  selectedFirstValue = this.value.trim();

  if (!selectedFirstValue) {
    secondDropdown.disabled = true;
    secondDropdown.innerHTML = '<option value="">Sélectionner un étage</option>';
    return;
  }

  secondDropdown.disabled = false;
  populateSecondColumnListbox(selectedFirstValue);

  // reset de la sélection document
  secondDropdown.value = '';
  selectedDocName = '';
  selectedDocNumber = null;
});

/* 3) Change Document => parse JSON comme Reference2 */
secondDropdown.addEventListener('change', function() {
  const val = this.value;

  if (val === 'addTable') {
    // plus tard tu m’expliques ce que tu veux faire
    // pour l’instant on évite de "casser" la sélection
    this.value = lastValidDocumentValue || '';
    return;
  }

  if (val === 'addMultipleTable') {
    this.value = lastValidDocumentValue || '';
    return;
  }

  // Document normal
  if (!val) {
    selectedDocName = '';
    selectedDocNumber = null;
    lastValidDocumentValue = '';
    return;
  }

  lastValidDocumentValue = val;

  try {
    const parsed = JSON.parse(val);
    selectedDocName = parsed.name || '';
    selectedDocNumber = (parsed.n == null ? null : Number(parsed.n));
  } catch {
    // fallback si jamais
    selectedDocName = '';
    selectedDocNumber = null;
  }

  // Pour l’instant on affiche juste la sélection (debug)
  const content = document.getElementById('content');
  content.textContent = `Projet: ${selectedFirstValue} | Document: ${selectedDocName} | Numéro: ${selectedDocNumber ?? '—'}`;
});

/* Lancement */
initGrist(onDataUpdate);
