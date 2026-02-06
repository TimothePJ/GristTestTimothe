(function () {
  // =======================
  //  STATE & UTILS
  // =======================
  const state = {
    // Découverts dynamiquement
    projectSelect: null,
    typeSelect: null,

    // Cache table Projet
    projets: null, // { ids:[], names:[], nums:[], _items:[] }

    // Sélection courante
    currentProjectId: null,
    currentProjectLabel: null,
    currentType: null,       // valeur technique (value) si utile ailleurs
    currentTypeLabel: null   // libellé EXACT affiché (ce qu'on écrit en Liste de plan)
  };

  // Normalisation permissive (pour comparer)
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase().replace(/\s+/g, " ").trim();
  }

  function toIntOrNull(v) {
    const s = String(v == null ? "" : v).trim();
    return /^\d+$/.test(s) ? parseInt(s, 10) : null;  // conserve 0, sinon null
  }

  // NEW: parse value/data-json like AffichageReference's options
  function tryParseProjectJson(raw) {
    if (!raw) return null;
    try {
      const data = JSON.parse(String(raw));
      if (data && typeof data.id === "number") return data;
    } catch (_) {}
    return null;
  }

  // =======================
  //  TABLE PROJET
  // =======================
  async function loadProjetsTable() {
    if (state.projets) return state.projets;
    const t = await grist.docApi.fetchTable("Projets");
    const ids = t.id || [];
    const cols = t.columns || {};
    const names = Array.isArray(cols.Nom_de_projet) ? cols.Nom_de_projet.map(v => String(v == null ? "" : v).trim()) : [];
    const nums  = Array.isArray(cols.Numero_de_projet) ? cols.Numero_de_projet.map(v => String(v == null ? "" : v).trim()) : [];

    const items = ids.map((id, i) => {
      const name = names[i] || "";
      const num  = nums[i]  || "";
      const nName = norm(name);
      const nNum  = norm(num);
      // Patterns usuels "NUM - NAME" et "NAME - NUM"
      const patterns = new Set([
        nName,
        nNum,
        nNum + " - " + nName,
        nName + " - " + nNum
      ]);
      return { id, name, num, nName, nNum, patterns };
    });

    state.projets = { ids, names, nums, _items: items };
    return state.projets;
  }

  // =======================
  //  DÉCOUVERTE DES SELECTS
  // =======================
  async function discoverContextControls() {
    await loadProjetsTable();
    const { names, nums } = state.projets;

    const selects = Array.from(document.querySelectorAll("select"));
    if (!selects.length) return;

    const nameSet = new Set(names.map(norm));
    const numSet  = new Set(nums.map(norm));

    function scoreProjectSelect(sel) {
      const opts = Array.from(sel.options || []);
      let hits = 0;
      for (const o of opts) {
        // PRIORITÉ: si value (ou data-json) est un JSON avec id, considère que c'est un bon candidat
        const j = tryParseProjectJson(o && o.value) || tryParseProjectJson(o && o.dataset && o.dataset.json);
        if (j && typeof j.id === "number") { hits += 3; continue; }

        const txt = norm(o && (o.text || o.value));
        if (!txt) continue;
        if (nameSet.has(txt) || numSet.has(txt)) { hits++; continue; }

        // inclusions partielles
        for (const n of names) {
          const nN = norm(n);
          if (nN && txt.indexOf(nN) !== -1) { hits++; break; }
        }
        for (const u of nums) {
          const nU = norm(u);
          if (nU && txt.indexOf(nU) !== -1) { hits++; break; }
        }
      }
      return hits;
    }

    // Types connus (juste pour repérage, le texte affiché sera utilisé tel quel)
    const KNOWN_TYPES = ["NDC", "COFFRAGE", "ARMATURES", "DÉMOLITION", "COUPES", "DEMOLITION"];
    const typeSet = new Set(KNOWN_TYPES.map(norm));

    function scoreTypeSelect(sel) {
      const opts = Array.from(sel.options || []);
      let hits = 0;
      for (const o of opts) {
        const raw = (o && (o.text || o.value)) ? String(o.text || o.value).trim() : "";
        if (!raw) continue;
        if (typeSet.has(norm(raw))) hits++;
      }
      return hits;
    }

    const scored = selects.map(sel => ({
      sel,
      pScore: scoreProjectSelect(sel),
      tScore: scoreTypeSelect(sel)
    }));

    // Projet = meilleur pScore
    scored.sort((a, b) => b.pScore - a.pScore);
    state.projectSelect = scored[0] && scored[0].pScore > 0 ? scored[0].sel : null;

    // Type = meilleur tScore
    scored.sort((a, b) => b.tScore - a.tScore);
    state.typeSelect = scored[0] && scored[0].tScore > 0 ? scored[0].sel : null;

    // Abonnements
    if (state.projectSelect && !state.projectSelect.__lpBound) {
      state.projectSelect.addEventListener("change", syncCurrentContext, { passive: true });
      state.projectSelect.__lpBound = true;
    }
    if (state.typeSelect && !state.typeSelect.__lpBound) {
      state.typeSelect.addEventListener("change", syncCurrentContext, { passive: true });
      state.typeSelect.__lpBound = true;
    }

    await syncCurrentContext();
  }

  // =======================
  //  RÉSOLUTION CONTEXTE
  // =======================
  function resolveProjetIdFrom(label, value) {
    const items = (state.projets && state.projets._items) ? state.projets._items : [];
    const nLabel = norm(label || "");
    const nValue = norm(value || "");

    // value numérique -> peut être un ID
    if (/^\d+$/.test(value || "")) {
      const asId = parseInt(value, 10);
      const byId = items.find(it => it.id === asId);
      if (byId) return { id: byId.id, label: byId.name || label || "" };
    }

    // égalité stricte sur name/num
    let cand = items.find(it => it.nName === nLabel || it.nNum === nLabel ||
                                it.nName === nValue || it.nNum === nValue);
    if (cand) return { id: cand.id, label: cand.name || label || "" };

    // patterns "num - name" / "name - num"
    cand = items.find(it => it.patterns.has(nLabel) || it.patterns.has(nValue));
    if (cand) return { id: cand.id, label: cand.name || label || "" };

    // inclusions
    const incl = items.filter(it =>
      (nLabel && (nLabel.indexOf(it.nName) !== -1 || nLabel.indexOf(it.nNum) !== -1)) ||
      (nValue && (nValue.indexOf(it.nName) !== -1 || nValue.indexOf(it.nNum) !== -1))
    );
    if (incl.length === 1) return { id: incl[0].id, label: incl[0].name || label || "" };

    if (incl.length > 1) {
      const both = incl.filter(it => nLabel.indexOf(it.nName) !== -1 && nLabel.indexOf(it.nNum) !== -1);
      if (both.length === 1) return { id: both[0].id, label: both[0].name || label || "" };
    }

    return { id: null, label: label || "" };
  }

  async function syncCurrentContext() {
    await loadProjetsTable();

    // Projet
    let projLabel = null, projValue = null;
    if (state.projectSelect) {
      const idx = state.projectSelect.selectedIndex;
      const opt = state.projectSelect.options && state.projectSelect.options[idx];
      projLabel = (opt && (opt.text || opt.label) ? String(opt.text || opt.label).trim() : (state.projectSelect.value || "").trim());
      projValue = (opt && opt.value ? String(opt.value).trim() : (state.projectSelect.value || "").trim());

      // NEW: priorité au JSON comme dans AffichageReference
      const j = tryParseProjectJson(projValue) || tryParseProjectJson(opt && opt.dataset && opt.dataset.json);
      if (j && typeof j.id === "number") {
        state.currentProjectId = j.id;
        state.currentProjectLabel = j.Projet || projLabel || "";
      } else {
        const resolved = resolveProjetIdFrom(projLabel, projValue);
        state.currentProjectId = resolved.id;
        state.currentProjectLabel = resolved.label;
      }
    } else {
      state.currentProjectId = null;
      state.currentProjectLabel = null;
    }

    // Type (prendre le TEXTE AFFICHÉ pour l'écriture en Liste de plan)
    let typeLabel = null, typeValue = null;
    if (state.typeSelect) {
      const idx2 = state.typeSelect.selectedIndex;
      const opt2 = state.typeSelect.options && state.typeSelect.options[idx2];
      typeLabel = (opt2 && (opt2.text || opt2.label) ? String(opt2.text || opt2.label).trim() : (state.typeSelect.value || "").trim());
      typeValue = (opt2 && opt2.value ? String(opt2.value).trim() : (state.typeSelect.value || "").trim());
    }
    state.currentTypeLabel = typeLabel || null;              // ce qu'on écrira dans Liste de plan
    state.currentType = typeValue || typeLabel || null;      // au cas où
  }

  // =======================
  //  DIALOG & SUBMIT
  // =======================
  async function openAjouterRefDocDialog() {
    if (!state.projectSelect || !state.typeSelect) {
      await discoverContextControls();
    } else {
      await syncCurrentContext();
    }

    if (state.currentProjectId == null) {
      console.warn("[AjouterReferenceDocument] Projet non détecté depuis la 1ère liste. Le dialog s'ouvre quand même.");
      return;
    }
    if (!state.currentTypeLabel) {
      console.warn("[AjouterReferenceDocument] Type non détecté depuis la 2ème liste. Utilisation d'un type vide par défaut.");;
      return;
    }

    const dlg = document.getElementById("dlg-ajouter-ref-doc");
    if (dlg && typeof dlg.showModal === "function") {
      dlg.showModal();
    }
  }

  async function onSubmit(ev) {
    ev.preventDefault();

    const inputNumero = document.getElementById("ard-numero");
    const inputNom = document.getElementById("ard-nom");
    const numeroStr = inputNumero ? String(inputNumero.value || "").trim() : "";
    const nom = inputNom ? String(inputNom.value || "").trim() : "";

    if (numeroStr === "" || !nom) {
      alert("Veuillez saisir le Numero et le Nom du document.");
      return;
    }

    await syncCurrentContext();

    const projetId = state.currentProjectId;
    const typeDocLabel = state.currentTypeLabel;

    if (projetId == null || !typeDocLabel) {
      console.warn("[AjouterReferenceDocument] Projet ou Type introuvable. Le formulaire reste éditable.");;
      return;
    }

    const numero = toIntOrNull(numeroStr);

    const actions = [
      // 1) Table des references
      ["AddRecord", "References", null, {
        NomProjet: projetId,      // Ref (ID projet)
        NomDocument: nom,
        NumeroDocument: numero    // 0 accepte
      }],
      // 2) Liste de plan : Type_document = libelle EXACT de la 2e liste
      ["AddRecord", "ListePlan_NDC_COF", null, {
        N_Document: String(numeroStr),
        Type_document: typeDocLabel, // texte exact de la liste
        DateDiffusion: null,
        Indice: "",
        Nom_projet: projetId,        // Ref (ID projet)
        Designation: nom
      }]
    ];

    try {
      await grist.docApi.applyUserActions(actions);
      const dlg = document.getElementById("dlg-ajouter-ref-doc");
      if (dlg && typeof dlg.close === "function") dlg.close();
    } catch (e) {
      console.error("Ajout echoue :", e);
      alert("L'ajout a echoue. Consultez la console pour les details.");
    }
  }

  // =======================
  //  INIT
  // =======================
  function init() {
    // Découverte initiale (non bloquante)
    discoverContextControls().catch(function (e) {
      console.warn("discoverContextControls() warn:", e);
    });

    // Ouverture du dialog via l'event du menu contextuel
    document.addEventListener("LP_OPEN_ADD_REF_DOC", openAjouterRefDocDialog);

    const form = document.getElementById("form-ajouter-ref-doc");
    if (form) form.addEventListener("submit", onSubmit);

    const cancelBtn = document.getElementById("ard-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", function () {
      const dlg = document.getElementById("dlg-ajouter-ref-doc");
      if (dlg && typeof dlg.close === "function") dlg.close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();