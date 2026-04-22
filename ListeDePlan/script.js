
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

function normalizeProjectName(v) {
  return (v ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ");
}

function getNomProjet(record) {
  const raw = (typeof record.Nom_projet === "object")
    ? record.Nom_projet.details
    : record.Nom_projet;

  return normalizeProjectName(raw);
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
window.LISTE_DE_PLAN_ALL_TYPES_VALUE = "__ALL_TYPES__";
window.LISTE_DE_PLAN_ALL_TYPES_LABEL = "Tous les types";
window.LISTE_DE_PLAN_ALL_ZONES_VALUE = "__ALL_ZONES__";
window.LISTE_DE_PLAN_ALL_ZONES_LABEL = "Toutes les zones";
window.LISTE_DE_PLAN_NO_ZONE_VALUE = "__NO_ZONE__";
window.LISTE_DE_PLAN_NO_ZONE_LABEL = "Sans zone";

grist.ready(async () => {
  await loadExternalComponents();
});

grist.onRecords(async (rec) => {
  window.records = rec.sort((a, b) => {
    const aDoc = a.NumeroDocument || "";
    const bDoc = b.NumeroDocument || "";

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
    const projectNameRaw = (typeof r.Nom_projet === 'object' ? r.Nom_projet.details : r.Nom_projet);
    const projectName = (typeof projectNameRaw === 'string') ? projectNameRaw.trim() : projectNameRaw;

    if (!projectName || !r.NumeroDocument || !r.Type_document) continue;

    if (!window.projectDocNumberToTypeMap.has(projectName)) {
      window.projectDocNumberToTypeMap.set(projectName, new Map());
    }
    const projectMap = window.projectDocNumberToTypeMap.get(projectName);

    if (!projectMap.has(r.NumeroDocument)) {
      projectMap.set(r.NumeroDocument, new Set());
    }
    projectMap.get(r.NumeroDocument).add(r.Type_document);
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
          const nomRaw = (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet);
          const nom = (typeof nomRaw === "string") ? nomRaw.trim() : nomRaw;
          return nom === selectedProject.trim();
        })
        .map(r => r.Type_document)
        .filter(val => typeof val === "string" && val.trim())
    )].sort();

    populateTypeDocumentDropdown(typesDocument);
    const selectedTypeValue = document.getElementById("typeDocumentDropdown").value ||
      (window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__");
    populateZoneDropdown(collectZoneValues(selectedProject, selectedTypeValue, window.records));
  } else {
    resetZoneDropdown(true);
  }

  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;
  const selectedZoneDocument = document.getElementById("zoneDropdown")?.value ||
    (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");
  if (selectedProject && selectedTypeDocument) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records, selectedZoneDocument);
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

function populateTypeDocumentDropdown(values) {
  const dropdown = document.getElementById("typeDocumentDropdown");
  if (!dropdown) return;

  const currentValue = dropdown.value;
  const allTypesValue = window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__";
  const allTypesLabel = window.LISTE_DE_PLAN_ALL_TYPES_LABEL || "Tous les types";

  dropdown.innerHTML = `<option value="${allTypesValue}">${allTypesLabel}</option>`;
  values.forEach((val) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    dropdown.appendChild(opt);
  });

  if (currentValue === allTypesValue || values.includes(currentValue)) {
    dropdown.value = currentValue;
  } else {
    dropdown.value = allTypesValue;
  }
}

function normalizeZoneDropdownValue(value) {
  return String(value ?? "").trim();
}

function getZoneDropdownOptionValue(zoneValue) {
  const normalizedZone = normalizeZoneDropdownValue(zoneValue);
  return normalizedZone || (window.LISTE_DE_PLAN_NO_ZONE_VALUE || "__NO_ZONE__");
}

function getZoneDropdownOptionLabel(zoneValue) {
  const normalizedZone = normalizeZoneDropdownValue(zoneValue);
  return normalizedZone || (window.LISTE_DE_PLAN_NO_ZONE_LABEL || "Sans zone");
}

function collectZoneValues(selectedProject, selectedTypeDocument, records = window.records) {
  const normalizedProject = normalizeProjectName(selectedProject);
  const normalizedType = String(selectedTypeDocument ?? "").trim();
  const includeAllTypes =
    !normalizedType ||
    normalizedType === (window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__");

  const zoneSet = new Set();
  for (const record of records || []) {
    if (getNomProjet(record) !== normalizedProject) continue;

    const recordType = String(record?.Type_document ?? "").trim();
    if (!recordType) continue;
    if (!includeAllTypes && recordType !== normalizedType) continue;

    zoneSet.add(normalizeZoneDropdownValue(record?.Zone));
  }

  return [...zoneSet].sort((left, right) => {
    const leftZone = normalizeZoneDropdownValue(left);
    const rightZone = normalizeZoneDropdownValue(right);
    if (!leftZone && rightZone) return 1;
    if (leftZone && !rightZone) return -1;
    return leftZone.localeCompare(rightZone, "fr", {
      sensitivity: "base",
      numeric: true
    });
  });
}

function populateZoneDropdown(values, preferredValue = null) {
  const dropdown = document.getElementById("zoneDropdown");
  if (!dropdown) return;

  const currentValue = preferredValue != null ? String(preferredValue) : String(dropdown.value || "");
  const allZonesValue = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";
  const allZonesLabel = window.LISTE_DE_PLAN_ALL_ZONES_LABEL || "Toutes les zones";

  dropdown.innerHTML = `<option value="${allZonesValue}">${allZonesLabel}</option>`;
  values.forEach((zoneValue) => {
    const option = document.createElement("option");
    option.value = getZoneDropdownOptionValue(zoneValue);
    option.textContent = getZoneDropdownOptionLabel(zoneValue);
    dropdown.appendChild(option);
  });

  const availableValues = new Set(values.map((zoneValue) => getZoneDropdownOptionValue(zoneValue)));
  if (currentValue === allZonesValue || availableValues.has(currentValue)) {
    dropdown.value = currentValue || allZonesValue;
  } else {
    dropdown.value = allZonesValue;
  }

  dropdown.disabled = false;
}

function resetZoneDropdown(disabled = false) {
  const dropdown = document.getElementById("zoneDropdown");
  if (!dropdown) return;

  const allZonesValue = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";
  const allZonesLabel = window.LISTE_DE_PLAN_ALL_ZONES_LABEL || "Toutes les zones";
  dropdown.innerHTML = `<option value="${allZonesValue}">${allZonesLabel}</option>`;
  dropdown.value = allZonesValue;
  dropdown.disabled = disabled;
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  if (!selectedProject) {
    populateTypeDocumentDropdown([]);
    resetZoneDropdown(true);
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
  populateTypeDocumentDropdown(typesDocument);
  console.log("Types affichés dans la deuxième liste :", typesDocument);
  document.getElementById("typeDocumentDropdown").value = window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__";
  populateZoneDropdown(
    collectZoneValues(
      selectedProject,
      document.getElementById("typeDocumentDropdown").value,
      window.records
    ),
    window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__"
  );
  afficherPlansFiltres(
    selectedProject,
    document.getElementById("typeDocumentDropdown").value,
    window.records,
    document.getElementById("zoneDropdown").value
  );
});

document.getElementById("typeDocumentDropdown").addEventListener("change", () => {
  if (window.__skipChangeEvent) return;

  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;
  const selectedZoneDocument = document.getElementById("zoneDropdown")?.value ||
    (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");

  if (selectedProject && selectedTypeDocument) {
    populateZoneDropdown(
      collectZoneValues(selectedProject, selectedTypeDocument, window.records),
      selectedZoneDocument
    );
    afficherPlansFiltres(
      selectedProject,
      selectedTypeDocument,
      window.records,
      document.getElementById("zoneDropdown").value
    );
  }
});

document.getElementById("zoneDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;
  const selectedZoneDocument = document.getElementById("zoneDropdown").value;

  if (selectedProject && selectedTypeDocument) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records, selectedZoneDocument);
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

// --- PDF Generation logic ---
document.addEventListener("DOMContentLoaded", () => {
  const btnPrint = document.getElementById("btn-print");
  if (btnPrint) {
    btnPrint.addEventListener("click", async () => {
      const selectedProject = document.getElementById("projectDropdown").value;
      if (!selectedProject) {
        alert("Veuillez sélectionner un projet avant d'imprimer.");
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("p", "mm", "a4");
      
      const logo1Url = await fetch("../img/VC_Logotype_Digital_RVB.jpg").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
      const logo2Url = await fetch("../img/bloc délégation bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
      const logo3Url = await fetch("../img/Logo DRTO fr - Bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));

      let startY = 40;
      doc.setFontSize(18);
      doc.text(`Projet : ${selectedProject}`, 16, 30);

      const output = document.getElementById("plans-output");
      const children = Array.from(output.querySelectorAll("h2, h3, table"));

      if (children.length === 0) {
        alert("Aucun plan à imprimer.");
        return;
      }

      for (const child of children) {
        if (child.tagName === "H2" || child.tagName === "H3") {
          if (startY > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            startY = 40;
          }
          doc.setFontSize(child.tagName === "H2" ? 16 : 14);
          doc.text(child.textContent, 14, startY);
          startY += 8;
        } else if (child.tagName === "TABLE") {
          doc.autoTable({
            html: child,
            startY: startY,
            margin: { top: 40 },
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 73, 144] },
            didDrawPage: function() {
              // startY is reset automatically by autoTable on new pages
            }
          });
          startY = doc.lastAutoTable.finalY + 10;
        }
      }

      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.addImage(logo1Url, "JPEG", 10, 10, 40, 15);
        doc.addImage(logo2Url, "PNG", doc.internal.pageSize.getWidth() - 92, 10, 40, 15);
        doc.addImage(logo3Url, "PNG", doc.internal.pageSize.getWidth() - 50, 10, 15, 15);
        doc.setFontSize(10);
        doc.text(`Page ${i} / ${totalPages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 10);
      }

      doc.save(`${selectedProject} - Plans.pdf`);
    });
  }
});

