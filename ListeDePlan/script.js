
  // --- shim: ensure normLabel exists before helpers use it ---
  (function(){
    try {
      if (typeof window !== 'undefined' && typeof window.normLabel !== 'function') {
        window.normLabel = function(s){ return String(s || '').trim().replace(/\s+/g, ' '); };
      }
      if (typeof normLabel !== 'function') {
        // local fallback (non-browser or no global)
        // eslint-disable-next-line no-func-assign
        normLabel = function(s){ return String(s || '').trim().replace(/\s+/g, ' '); };
      }
    } catch (_) {
      // last resort
      // eslint-disable-next-line no-inner-declarations
      function normLabel(s){ return String(s || '').trim().replace(/\s+/g, ' '); }
    }
  })();

  // ---- Mémoire locale de la sélection projet/type ----
  const LS_KEYS = {
    PROJECT_LABEL: 'LP_LAST_PROJECT_LABEL',
    PROJECT_ID: 'LP_LAST_PROJECT_ID',
    TYPE_LABEL: 'LP_LAST_TYPE_LABEL',
  };

  function saveLastSelection({ projectLabel, projectId, typeLabel }) {
    try {
      if (projectLabel) localStorage.setItem(LS_KEYS.PROJECT_LABEL, projectLabel);
      if (projectId != null) localStorage.setItem(LS_KEYS.PROJECT_ID, String(projectId));
      if (typeLabel) localStorage.setItem(LS_KEYS.TYPE_LABEL, typeLabel);
    } catch {}
  }

  function loadLastSelection() {
    try {
      const lbl = localStorage.getItem(LS_KEYS.PROJECT_LABEL) || '';
      const idStr = localStorage.getItem(LS_KEYS.PROJECT_ID);
      const t = localStorage.getItem(LS_KEYS.TYPE_LABEL) || '';
      const id = idStr && /^\d+$/.test(idStr) ? Number(idStr) : null;
      return { projectLabel: lbl, projectId: id, typeLabel: t };
    } catch { return { projectLabel: '', projectId: null, typeLabel: '' }; }
  }

  // ---- Sélection robuste des dropdowns ----
  function getSelectedLabelAndValue(selectEl) {
    if (!selectEl) return { label: "", value: "" };
    const idx = selectEl.selectedIndex;
    let opt = idx >= 0 ? selectEl.options[idx] : null;
    if (!opt && selectEl.options && selectEl.options.length === 1) opt = selectEl.options[0];
    const rawVal = (opt && typeof opt.value !== "undefined") ? opt.value : selectEl.value;
    const rawTxt = opt ? opt.textContent : "";
    const value = normLabel(rawVal);
    const text  = normLabel(rawTxt);
    const label = text || value;
    return { label, value };
  }

  function detectProjectSelect() {
    // 1) id standard
    let el = document.getElementById('projectDropdown');
    if (el && el.tagName === 'SELECT') return el;

    // 2) meilleur match par heuristique
    const selects = Array.from(document.querySelectorAll('select'));
    if (!selects.length) return null;

    // Construire une set de labels connus si possible
    const known = new Set(Array.from(PROJECT_MAP.keys()).map(normLabel));
    let best = null, bestScore = -1;

    for (const s of selects) {
      const idn = (s.id || "").toLowerCase();
      const nm  = (s.name || "").toLowerCase();
      let score = 0;

      if (idn.includes('project') || nm.includes('project') || idn.includes('projet') || nm.includes('projet')) score += 3;

      const opts = Array.from(s.options || []);
      for (const o of opts) {
        const v = normLabel(o.value);
        const t = normLabel(o.textContent);
        if (known.has(v)) score += 2;
        if (known.has(t)) score += 2;
        if (v && v === t) score += 0.5;
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function detectTypeSelect() {
    // 1) id standard
    let el = document.getElementById('typeDropdown');
    if (el && el.tagName === 'SELECT') return el;

    // 2) heuristique: chercher un select qui contient des libellés de type courants
    const candidates = Array.from(document.querySelectorAll('select'));
    const typeHints = new Set(['ndc','cof','coffrage','armatures','plans','plan']);
    let best = null, bestScore = -1;
    for (const s of candidates) {
      const idn = (s.id || "").toLowerCase();
      const nm  = (s.name || "").toLowerCase();
      let score = 0;
      if (idn.includes('type') || nm.includes('type')) score += 2;
      for (const o of Array.from(s.options || [])) {
        const t = normLabel(o.textContent).toLowerCase();
        for (const h of typeHints) {
          if (t.includes(h)) { score += 1.2; break; }

  // ==== Hooks surchargables par l'app (pour widgets custom non-<select>) ====
  // L'appli peut définir window.__LP_GET_CURRENT_PROJECT = () => ({ label, id })
  // et window.__LP_GET_CURRENT_TYPE = () => ({ label })
  // Ces hooks seront utilisés en priorité.
  function callHook(fn, fallback) {
    try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; }
  }

  function detectCustomProject() {
    // 1) Hook utilisateur
    const hook = callHook(window.__LP_GET_CURRENT_PROJECT, null);
    if (hook && (hook.label || hook.id)) return hook;

    // 2) Heuristiques pour widgets custom (div/span)
    const candidates = Array.from(document.querySelectorAll('[data-role*=\"project\" i], [role=\"listbox\" i], [aria-label*=\"projet\" i], [aria-labelledby*=\"projet\" i]'));
    for (const el of candidates) {
      // Rechercher un enfant marqué sélectionné
      const sel = el.querySelector('[aria-selected=\"true\"], .selected, [data-selected=\"true\"]');
      const text = (sel ? sel.textContent : el.textContent) || '';
      const label = normLabel(text);
      if (label) {
        // Essayer d'inférer un id via attributes
        let id = null;
        const valAttr = sel?.getAttribute?.('data-id') || sel?.getAttribute?.('data-value') || el.getAttribute?.('data-id');
        if (valAttr && /^\d+$/.test(valAttr)) id = Number(valAttr);
        return { label, id };
      }
    }
    return null;
  }

  function detectCustomType() {
    const hook = callHook(window.__LP_GET_CURRENT_TYPE, null);
    if (hook && hook.label) return hook;
    const el = document.querySelector('[data-role*=\"type\" i], [aria-label*=\"type\" i]');
    if (el) {
      const sel = el.querySelector('[aria-selected=\"true\"], .selected, [data-selected=\"true\"]');
      const text = (sel ? sel.textContent : el.textContent) || '';
      const label = normLabel(text);
      if (label) return { label };
    }
    return null;
  }
        }
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }
window.__skipChangeEvent = false;
window.records = [];

grist.ready(async () => {
  await loadExternalComponents();
});

grist.onRecords(async (rec) => {
  window.records = rec.sort((a, b) => {
    const aDoc = a.N_Document || "";
    const bDoc = b.N_Document || "";

    const isANumber = !isNaN(aDoc) && !isNaN(parseFloat(aDoc));
    const isBNumber = !isNaN(bDoc) && !isNaN(parseFloat(bDoc));

    if (isANumber && isBNumber) {
      return parseFloat(aDoc) - parseFloat(bDoc);
    }

    return aDoc.localeCompare(bDoc);
  });

  const projetsDict = await chargerProjetsMap();
  const projets = Object.keys(projetsDict).sort();

  // Create a project-specific map to validate document number uniqueness.
  window.projectDocNumberToTypeMap = new Map();
  for (const r of window.records) {
    const projectName = typeof r.Nom_projet === 'object' ? r.Nom_projet.details : r.Nom_projet;
    if (!projectName || !r.N_Document || !r.Type_document) continue;

    if (!window.projectDocNumberToTypeMap.has(projectName)) {
      window.projectDocNumberToTypeMap.set(projectName, new Map());
    }
    const projectMap = window.projectDocNumberToTypeMap.get(projectName);

    if (!projectMap.has(r.N_Document)) {
      projectMap.set(r.N_Document, new Set());
    }
    projectMap.get(r.N_Document).add(r.Type_document);
  }

  populateDropdown("projectDropdown", projets);

  const selectedProject = document.getElementById("projectDropdown").value;
  if (selectedProject) {
    const projetsDict = await chargerProjetsMap();
    for (const r of window.records) {
      if (typeof r.Nom_projet === "number") {
        const projId = r.Nom_projet;
        const projLabel = Object.entries(projetsDict).find(([label, id]) => id === projId)?.[0] || null;
        if (projLabel) {
          r.Nom_projet = { id: projId, details: projLabel };
        }
      }
    }  

    const typesDocument = [...new Set(
      window.records
        .filter(r => {
          const nom = typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet;
          return nom === selectedProject;
        })
        .map(r => r.Type_document)
        .filter(val => typeof val === "string" && val.trim())
    )].sort();

    populateDropdown("typeDocumentDropdown", typesDocument);
  }

  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;
  if (selectedProject && selectedTypeDocument) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records);
  }
});

function populateDropdown(id, values) {
  const dropdown = document.getElementById(id);
  const currentValue = dropdown.value;
  const defaultOption = dropdown.options[0]?.textContent || "Choisir";

  dropdown.innerHTML = `<option value="">${defaultOption}</option>`;
  values.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    dropdown.appendChild(opt);
  });

  if (values.includes(currentValue)) {
    dropdown.value = currentValue;
  }
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  if (!selectedProject) {
    populateDropdown("typeDocumentDropdown", []);
    document.getElementById("plans-output").innerHTML = "";
    return;
  }

  const typesDocumentSet = new Set();

  if(!window.records)
    console.log("no window records");

  for (const r of window.records) {
    let label = null;

    if (typeof r.Nom_projet === "object" && r.Nom_projet !== null) {
      if ("details" in r.Nom_projet) label = r.Nom_projet.details;
      else if ("display" in r.Nom_projet) label = r.Nom_projet.display;
    } else if (typeof r.Nom_projet === "string") {
      label = r.Nom_projet;
    } else if (typeof r.Nom_projet === "number") {
      label = Object.entries(window.projetsDictGlobal || {}).find(([k, v]) => v === r.Nom_projet)?.[0] || null;
    }

    if (label === selectedProject && typeof r.Type_document === "string" && r.Type_document.trim()) {
      typesDocumentSet.add(r.Type_document.trim());
    }
  }

  const typesDocument = [...typesDocumentSet].sort();
  populateDropdown("typeDocumentDropdown", typesDocument);
  console.log("Types affichés dans la deuxième liste :", typesDocument);
  document.getElementById("typeDocumentDropdown").value = "";
  document.getElementById("plans-output").innerHTML = "";
});

document.getElementById("typeDocumentDropdown").addEventListener("change", () => {
  if (window.__skipChangeEvent) return;

  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;

  if (selectedProject && selectedTypeDocument) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records);
  }
});

async function supprimerLignesSansDate() {
  console.log("== SUPPRESSION : routine appelée ==");

  const tableName = "ListePlan_NDC_COF";
  const data = await grist.docApi.fetchTable(tableName);
  console.log("=== Données brutes ===", data);

  const rows = Object.entries(data.records || {}).map(([id, row]) => {
    const r = { id: parseInt(id), ...row };
    console.log(`Ligne ${r.id} :`, r);
    return r;
  });

  const lignesASupprimer = rows.filter(r =>
    r.DateDiffusion === null || r.DateDiffusion === undefined
  );

  console.log("=== Lignes ciblées ===", lignesASupprimer.map(r => r.id));

  if (lignesASupprimer.length === 0) {
    console.log("Aucune ligne à supprimer.");
    return;
  }

  const actions = lignesASupprimer.map(r => [
    "DeleteRecord",
    tableName,
    r.id
  ]);

  console.log("=== Actions envoyées ===", actions);

  await grist.docApi.applyUserActions(actions);
  console.log("=== Suppression exécutée ===");

  const table = document.querySelector(".plan-table");
  if (!table) {
    console.warn("Table HTML non trouvée");
    return;
  }

  const lignesDOM = table.querySelectorAll("tbody tr");
  lignesDOM.forEach(tr => {
    const cellules = tr.querySelectorAll("td");
    const contientDates = Array.from(cellules).some(td => {
      const text = td.textContent.trim();
      return /^\d{2}\/\d{2}\/\d{4}$/.test(text);
    });

    if (!contientDates) {
      console.log("→ Suppression visuelle ligne :", tr);
      tr.remove();
    }
  });
}

async function loadExternalComponents() {
  try {
    const placeholder = document.getElementById('dialog-placeholder');
    if (!placeholder) {
      console.error("L'élément #dialog-placeholder est introuvable dans index.html.");
      return;
    }

    // 1) Injecter la boîte de dialogue "Ajouter Projet"
    {
      const respProj = await fetch('AjouterProjet.html');
      if (!respProj.ok) throw new Error(`Erreur HTTP AjouterProjet.html: ${respProj.status}`);
      const htmlProj = await respProj.text();

      // on remplace le contenu au premier chargement (comportement actuel)
      placeholder.innerHTML = htmlProj;

      if (typeof initAjouterProjet === 'function') {
        initAjouterProjet();
      } else {
        console.error("initAjouterProjet() introuvable. Vérifie que AjouterProjet.js est bien chargé.");
      }
    }

    // 2) Injecter la boîte de dialogue "Ajouter document (Référence)"
    {
      const respRef = await fetch('AjouterReferenceDocument.html');
      if (!respRef.ok) throw new Error(`Erreur HTTP AjouterReferenceDocument.html: ${respRef.status}`);
      const htmlRef = await respRef.text();

      // on ajoute APRES le contenu existant, sans l’écraser
      placeholder.insertAdjacentHTML('beforeend', htmlRef);

      if (typeof initAjouterReferenceDocument === 'function') {
        initAjouterReferenceDocument();
      } else {
        console.error("initAjouterReferenceDocument() introuvable. Vérifie que AjouterReferenceDocument.js est bien chargé (index.html).");
      }
    }

  } catch (error) {
    console.error("Erreur lors du chargement des composants externes :", error);
  }
}



    // Mémorise la sélection si on a des selects standards
    const projSel = detectProjectSelect();
    const typeSel = detectTypeSelect();
    if (projSel && !projSel.__lpSaveBound) {
      projSel.addEventListener('change', () => {
        const v = getSelectedLabelAndValue(projSel);
        const id = (window.__LP_PROJECT_MAP ? window.__LP_PROJECT_MAP.get(v.label) : null) ?? null;
        saveLastSelection({ projectLabel: v.label, projectId: id, typeLabel: null });
      });
      projSel.__lpSaveBound = true;
    }
    if (typeSel && !typeSel.__lpSaveBound) {
      typeSel.addEventListener('change', () => {
        const v = getSelectedLabelAndValue(typeSel);
        saveLastSelection({ projectLabel: null, projectId: null, typeLabel: v.label });
      });
      typeSel.__lpSaveBound = true;
    }

