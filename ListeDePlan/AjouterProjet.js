(function () {
  // Reproduit la fenêtre "Ajouter document" d'AffichageReference,
  // adaptée à ListeDePlan. Ouvre sur l'événement LP_OPEN_ADD_REF_DOC
  // (déclenché par le menu contextuel), et écrit dans:
  //   - References (NomProjet, NomDocument, NumeroDocument, Emetteur, DateLimite, Service, etc.)
  //   - ListePlan_NDC_COF (N_Document, Type_document, Nom_projet, Designation, ...)

  const STATE = {
    projectName: null,       // libellé du projet (depuis #projectDropdown)
    projectId: null,         // id du projet (table Projet)
    typeDocLabel: null       // libellé exact sélectionné (depuis #typeDocumentDropdown)
  };
  // === Helpers pour assurer la présence du dialog "Ajouter document" ===
  let __dialogBound = false;

  function getOrCreateDialogPlaceholder() {
    let el = document.getElementById('dialog-placeholder');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dialog-placeholder';
      el.style.display = 'contents';
      document.body.appendChild(el);
      console.warn('[AjouterProjet] Placeholder "dialog-placeholder" créé dynamiquement.');
    }
    return el;
  }

  function buildAddDocumentDialogHTML() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<dialog id="addDocumentDialog">
  <form id="form-add-document" method="dialog" style="min-width:420px;max-width:600px">
    <h3>Ajouter un document</h3>

    <label for="currentProjectDisplay">Projet sélectionné</label>
    <input id="currentProjectDisplay" type="text" readonly />

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
      <div>
        <label for="documentNumber">Numéro de document</label>
        <input id="documentNumber" type="text" required />
      </div>
      <div>
        <label for="defaultDatelimite">Date limite</label>
        <input id="defaultDatelimite" type="date" />
      </div>
    </div>

    <label for="documentName" style="margin-top:8px">Nom du document</label>
    <input id="documentName" type="text" required />

    <div style="margin-top:10px;display:flex;align-items:center;gap:8px;justify-content:space-between">
      <strong>Émetteurs</strong>
      <button id="addCustomEmitterRowBtn" type="button">+ Émetteur perso</button>
    </div>
    <div id="emetteurDropdown" style="display:flex;flex-direction:column;gap:6px;margin-top:6px"></div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button id="cancelAddDocumentButton" type="button">Annuler</button>
      <button type="submit">Ajouter</button>
    </div>
  </form>
</dialog>`;
    return wrap.firstElementChild;
  }

  function bindDialogControls() {
    if (__dialogBound) return;
    const form = document.getElementById('form-add-document');
    if (form) {
      form.addEventListener('submit', onSubmit);
      __dialogBound = true;
    }
    const cancelBtn = document.getElementById('cancelAddDocumentButton');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        const dlg = document.getElementById('addDocumentDialog');
        if (dlg && typeof dlg.close === "function") dlg.close();
      });
    }
    const addCustomBtn = document.getElementById('addCustomEmitterRowBtn');
    if (addCustomBtn) {
      addCustomBtn.addEventListener('click', () => {
        const container = document.getElementById('emetteurDropdown');
        if (container) container.appendChild(makeEmitterRow("", true, false, ""));
      });
    }
  }

  function ensureAddDocumentDialog() {
    let dlg = document.getElementById('addDocumentDialog');
    if (!dlg) {
      const placeholder = getOrCreateDialogPlaceholder();
      dlg = buildAddDocumentDialogHTML();
      placeholder.appendChild(dlg);
    }
    bindDialogControls();
    return dlg;
  }


  // --- Utils ---
  function normStr(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
  function uniq(arr) { return Array.from(new Set(arr)); }
  function byFR(a,b){ return String(a).localeCompare(String(b), 'fr', {sensitivity:'base'}); }

  // Trouve l'ID du projet courant depuis le libellé exact
  async function resolveProjectId(projectName) {
    const t = await grist.docApi.fetchTable("Projet");
    // format colonnes attendu: t.Projet[], t.id[]
    if (t && t.Projet && t.id && Array.isArray(t.Projet) && Array.isArray(t.id)) {
      const idx = t.Projet.findIndex(p => String(p) === String(projectName));
      if (idx >= 0) return t.id[idx];
    }
    // fallback si renvoi tableau d'objets
    if (Array.isArray(t)) {
      const row = t.find(r => String(r.Projet) === String(projectName));
      if (row) return row.id;
    }
    return null;
  }

  // Table Team.Service (1ère ligne)
  async function getTeamService() {
    try {
      const teamTable = await grist.docApi.fetchTable('Team');
      if (Array.isArray(teamTable) && teamTable.length > 0) {
        return teamTable[0].Service || "";
      } else if (teamTable && Array.isArray(teamTable.Service)) {
        return teamTable.Service[0] || "";
      }
    } catch (e) {
      console.warn("getTeamService() warn:", e);
    }
    return "";
  }

  // Table Emetteurs (colonne Emetteurs)
  async function getDefaultEmetteurs() {
    try {
      const emitterTable = await grist.docApi.fetchTable('Emetteurs');
      if (emitterTable && Array.isArray(emitterTable.Emetteurs)) {
        return emitterTable.Emetteurs.filter(Boolean).sort(byFR);
      }
      if (Array.isArray(emitterTable)) {
        return emitterTable.map(r => r.Emetteurs).filter(Boolean).sort(byFR);
      }
    } catch (e) {
      console.warn("getDefaultEmetteurs() warn:", e);
    }
    return [];
  }

  // Récupère les émetteurs déjà utilisés pour le projet dans References
  async function getProjectEmetteurs(projetId) {
    try {
      const t = await grist.docApi.fetchTable('References');
      let rows = [];
      if (t && Array.isArray(t.id) && Array.isArray(t.NomProjet) && Array.isArray(t.Emetteur)) {
        for (let i = 0; i < t.id.length; i++) {
          if (t.NomProjet[i] === projetId && t.Emetteur[i]) rows.push(String(t.Emetteur[i]));
        }
      } else if (Array.isArray(t)) {
        rows = t.filter(r => r.NomProjet === projetId && r.Emetteur).map(r => String(r.Emetteur));
      }
      return uniq(rows).sort(byFR);
    } catch (e) {
      console.warn("getProjectEmetteurs() warn:", e);
      return [];
    }
  }

  function clearContainer(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function makeEmitterRow(label, isCustom=false, prechecked=false, valueOverride=null) {
    const row = document.createElement('div');
    row.className = isCustom ? 'emetteur-item custom-emetteur' : 'emetteur-item';
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!prechecked;

    const spanOrInput = isCustom ? (function(){
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = "Nom de l'émetteur";
      if (valueOverride) inp.value = valueOverride;
      inp.style.flex = "1";
      return inp;
    })() : (function(){
      const sp = document.createElement('span');
      sp.textContent = label;
      return sp;
    })();

    if (!isCustom) {
      cb.value = label;
    } else {
      cb.dataset.custom = "1";
    }

    // (Optionnel) bouton supprimer pour les lignes custom
    if (isCustom) {
      const del = document.createElement('button');
      del.type = "button";
      del.textContent = "✕";
      del.title = "Supprimer";
      del.style.marginLeft = "4px";
      del.addEventListener('click', () => row.remove());
      row.appendChild(cb);
      row.appendChild(spanOrInput);
      row.appendChild(del);
    } else {
      row.appendChild(cb);
      row.appendChild(spanOrInput);
    }
    return row;
  }

  async function resetAddDocumentDialog() {
    ensureAddDocumentDialog();
    const num = document.getElementById('documentNumber');
    const nom = document.getElementById('documentName');
    const dateLim = document.getElementById('defaultDatelimite');
    if (num) num.value = "";
    if (nom) nom.value = "";
    if (dateLim) dateLim.value = "";

    // Affiche le projet courant
    const projDisp = document.getElementById('currentProjectDisplay');
    if (projDisp) projDisp.value = String(STATE.projectName || "");

    const container = document.getElementById('emetteurDropdown');
    if (!container) {
      console.warn('[AjouterProjet] emetteurDropdown manquant — création/skip.');
      ensureAddDocumentDialog();
    }
    const _container = document.getElementById('emetteurDropdown');
    clearContainer(_container);

    // Ligne "Tout sélectionner"
    const selectAllRow = document.createElement('div');
    selectAllRow.className = "emetteur-item";
    selectAllRow.style.display = "flex";
    selectAllRow.style.alignItems = "center";
    selectAllRow.style.gap = "8px";
    const cbAll = document.createElement('input');
    cbAll.type = "checkbox";
    cbAll.id = "selectAllEmitters";
    const labAll = document.createElement('span');
    labAll.textContent = "Tout sélectionner";
    selectAllRow.appendChild(cbAll);
    selectAllRow.appendChild(labAll);
    container.appendChild(selectAllRow);

    // Émetteurs "par défaut" + propres au projet
    const [defList, projList] = await Promise.all([
      getDefaultEmetteurs(),
      STATE.projectId ? getProjectEmetteurs(STATE.projectId) : Promise.resolve([])
    ]);
    const all = uniq([...(defList||[]), ...(projList||[])]).sort(byFR);
    all.forEach(em => container.appendChild(makeEmitterRow(em, false, false)));

    cbAll.addEventListener('change', () => {
      container.querySelectorAll('.emetteur-item input[type="checkbox"]').forEach(cb => {
        if (cb.id === "selectAllEmitters") return;
        cb.checked = cbAll.checked;
      });
    });

    // Au moins 1 ligne custom vide
    container.appendChild(makeEmitterRow("", true, false, ""));
  }

  function collectSelectedEmitters() {
    const container = document.getElementById('emetteurDropdown');
    const rows = container ? Array.from(container.children) : [];
    const out = [];
    for (const r of rows) {
      const cb = r.querySelector('input[type="checkbox"]');
      if (!cb || cb.id === "selectAllEmitters" || !cb.checked) continue;

      if (cb.dataset.custom === "1") {
        const txt = r.querySelector('input[type="text"]');
        const v = txt ? String(txt.value || "").trim() : "";
        if (v) out.push(v);
      } else {
        out.push(String(cb.value || "").trim());
      }
    }
    return uniq(out.filter(Boolean));
  }

  async function openDialog() {
    // Récupère le contexte (projet + type) depuis les 2 listes de la page
    const selProj = document.getElementById("projectDropdown");
    const selType = document.getElementById("typeDocumentDropdown");
    const projectName = selProj ? selProj.value : "";
    const typeLabel = selType && selType.options && selType.selectedIndex >= 0
      ? selType.options[selType.selectedIndex].text
      : "";

    if (!projectName) {
      alert("Sélectionnez d'abord un projet.");
      return;
    }
    if (!typeLabel) {
      alert("Sélectionnez d'abord un type de document.");
      return;
    }

    STATE.projectName = projectName;
    STATE.typeDocLabel = typeLabel;
    STATE.projectId = await resolveProjectId(projectName);
    if (!STATE.projectId) {
      alert("Projet introuvable dans la table Projet.");
      return;
    }

    ensureAddDocumentDialog();
    await resetAddDocumentDialog();

    const dlg = document.getElementById('addDocumentDialog');
    if (dlg && typeof dlg.showModal === "function") dlg.showModal();
  }

  async function onSubmit(e) {
    e.preventDefault();

    const numEl = document.getElementById('documentNumber');
    const nameEl = document.getElementById('documentName');
    const dateEl = document.getElementById('defaultDatelimite');

    const numeroStr = numEl ? String(numEl.value || "").trim() : "";
    const nom = nameEl ? String(nameEl.value || "").trim() : "";
    let datelimite = dateEl ? String(dateEl.value || "").trim() : "";

    if (!numeroStr || !nom) {
      alert("Renseignez Numéro et Nom du document.");
      return;
    }
    // Valeur par défaut comme dans AffichageReference
    if (!datelimite) datelimite = "1900-01-01";

    const numero = Number.parseInt(numeroStr, 10);
    const selectedEmitters = collectSelectedEmitters();
    if (selectedEmitters.length === 0) {
      alert("Sélectionnez au moins un émetteur (ou ajoutez un émetteur personnalisé).");
      return;
    }

    const serviceValue = await getTeamService();

    // 1) Ajouts dans References (un par émetteur)
    const actions = [];
    for (const em of selectedEmitters) {
      actions.push(["AddRecord", "References", null, {
        // On écrit le LIBELLÉ du projet, pas l'ID (conforme à tes données)
        NomProjet: (STATE.projectId ?? STATE.projectName),  // Ref (id) si dispo, sinon libellé
        NomDocument: nom,
        NumeroDocument: numeroStr,
        Emetteur: em,
        Reference: "_",
        Indice: "-",
        Recu: "1900-01-01",
        DescriptionObservations: "EN ATTENTE",
        DateLimite: datelimite,
        Service: serviceValue
      }]);
    }

    // 2) Ajout côté Liste de plan (une seule ligne "tête" pour apparaitre dans la vue)
    actions.push(["AddRecord", "ListePlan_NDC_COF", null, {
      N_Document: String(numeroStr),
      Type_document: STATE.typeDocLabel,
      DateDiffusion: null,
      Indice: "",
      Nom_projet: STATE.projectId,
      Designation: nom
    }]);

    try {
      await grist.docApi.applyUserActions(actions);
      const dlg = document.getElementById('addDocumentDialog');
      if (dlg && typeof dlg.close === "function") dlg.close();
    } catch (err) {
      console.error("Erreur lors de l'ajout :", err);
      alert("L'ajout a échoué. Voir la console pour les détails.");
    }
  }

  function init() {
    // Ouvrir via menu contextuel
    document.addEventListener("LP_OPEN_ADD_REF_DOC", openDialog);

    // Bouton Annuler
    const cancelBtn = document.getElementById('cancelAddDocumentButton');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      const dlg = document.getElementById('addDocumentDialog');
      if (dlg && typeof dlg.close === "function") dlg.close();
    });

    // Bouton + ligne custom
    const addCustomBtn = document.getElementById('addCustomEmitterRowBtn');
    if (addCustomBtn) addCustomBtn.addEventListener('click', () => {
      const container = document.getElementById('emetteurDropdown');
      if (container) container.appendChild(makeEmitterRow("", true, false, ""));
    });

    // Submit
    const form = document.getElementById('form-add-document');
    if (form) form.addEventListener('submit', onSubmit);
  }

  // Expose init() pour l’appel depuis script.js (après insertion HTML)
  window.initAjouterReferenceDocument = init;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
