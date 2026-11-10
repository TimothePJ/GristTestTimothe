// Fenetre « Rechercher un plan » de planning-synchro (#ps-plan-search-modal),
// ouverte par la loupe de la vue Graphique (#ps-search-open).
//
// Lecture seule : on cherche un plan du projet affiche par son N°, son nom ou
// les deux, on filtre par zone, type de document et etat, et chaque resultat
// donne son echeance sans lissage et, quand le lissage est actif, son echeance
// lissee. Les plans sont les taches du graphique telles que les tient le
// controleur du lissage (top/smoothingController.js) : ChartTask sans lissage,
// SmoothedTask avec. Aucune date n'est recalculee ici.
//
// Meme decoupage que top/monthTasksModal.js : un modele PUR (aucun DOM, teste
// dans tests/planSearchModal.test.mjs) puis un controleur DOM
// (createPlanSearchModal) qui n'en rend que le resultat. Memes libelles que la
// liste des taches du mois (lieu, avancement, « réalisation forcée le … »,
// « avancé pour libérer l'armature … »). Tout texte venant d'une tache est
// echappe avant d'entrer dans le HTML.

import { TYPE_META, TYPE_ORDER, formatDateFr } from "./taskLabels.js";
import { placeOf, progressLabelOf, pulledForLabel } from "./monthTasksModal.js";

// --- modele pur (aucun DOM) -----------------------------------------------------

// Valeurs du filtre « Etat ».
export const PLAN_STATUS = Object.freeze({
  TODO: "a-faire",
  DONE: "realises",
  ADVANCED: "avances",
  MANUAL: "manuels",
});

const NO_MATCH_TEXT =
  "Aucun plan ne correspond à cette recherche. Modifiez le N°, le nom ou les filtres.";

function searchText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

// { tasks, active } -> entrees de la recherche, dans l'ordre des taches (celui
// du graphique : echeance, N°).
//   tasks  : SmoothedTask[] (resultat du lissage) si active, ChartTask[] sinon ;
//   active : lissage actif pour le service affiche.
export function buildPlanSearchEntries({ tasks, active }) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task) => {
    const meta = TYPE_META[task.type] || TYPE_META.AUTRES;
    return {
      rowId: task.rowId ?? null,
      id2: String(task.id2 ?? "").trim(),
      name: String(task.name ?? "").trim(),
      zone: String(task.zone ?? "").trim(),
      type: task.type,
      typeLabel: meta.label,
      typeColor: meta.color,
      place: placeOf(task),
      // Echeance sans lissage : fin de la barre dessinee par le planning.
      dueIso: task.dueIso,
      smoothedIso: active ? task.smoothedIso ?? null : null,
      monthsAdvanced: active ? task.monthsAdvanced ?? 0 : 0,
      moved: Boolean(active && task.moved),
      // Plan dont la date de fin est imposee (smoothedIso = cette date).
      manual: Boolean(active && task.manual),
      pulledFor: active ? pulledForLabel(task, list) : null,
      realized: Boolean(task.realized),
      progressLabel: progressLabelOf(task),
      closureNote: task.closureLabel ? `réalisation forcée le ${task.closureLabel}` : null,
    };
  });
}

// Entrees qui correspondent a TOUS les criteres renseignes. N° et nom : texte
// contenu, sans tenir compte des accents ni des majuscules. Zone et type :
// valeur exacte. Etat : PLAN_STATUS. Un critere vide ne filtre rien.
export function filterPlanEntries(entries, { number = "", name = "", zone = "", type = "", status = "" } = {}) {
  const numberQuery = searchText(number);
  const nameQuery = searchText(name);

  return (entries || []).filter((entry) => {
    if (numberQuery && !searchText(entry.id2).includes(numberQuery)) return false;
    if (nameQuery && !searchText(entry.name).includes(nameQuery)) return false;
    if (zone && entry.zone !== zone) return false;
    if (type && entry.type !== type) return false;
    if (status === PLAN_STATUS.TODO && entry.realized) return false;
    if (status === PLAN_STATUS.DONE && !entry.realized) return false;
    if (status === PLAN_STATUS.ADVANCED && !entry.moved) return false;
    if (status === PLAN_STATUS.MANUAL && !entry.manual) return false;
    return true;
  });
}

// Zones et types presents, pour les listes des filtres. Types dans l'ordre et
// avec les libelles du graphique.
export function planFilterOptions(entries) {
  const list = entries || [];
  const zones = [...new Set(list.map((entry) => entry.zone).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "fr", { numeric: true, sensitivity: "base" })
  );
  const presentTypes = new Set(list.map((entry) => entry.type));
  const types = TYPE_ORDER.filter((type) => presentTypes.has(type)).map((type) => ({
    value: type,
    label: TYPE_META[type].label,
  }));
  return { zones, types };
}

// --- rendu HTML ---------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

function renderEmpty(text) {
  return `<p class="ps-plan-search-empty">${escapeHtml(text)}</p>`;
}

// « N mois plus tôt » / « N mois plus tard » / « même mois » : l'écart entre la
// date imposée et l'échéance sans lissage (monthsAdvanced < 0 = plus tard).
function manualShiftLabel(monthsAdvanced) {
  const months = Number(monthsAdvanced) || 0;
  if (months > 0) return `${months} mois plus tôt`;
  if (months < 0) return `${-months} mois plus tard`;
  return "même mois";
}

function renderSmoothedCell(entry) {
  if (entry.manual) {
    return `<td class="ps-plan-search-date ps-plan-search-date--manual">
    <strong>${escapeHtml(formatDateFr(entry.smoothedIso))}</strong>
    <span class="ps-plan-search-note">date manuelle</span>
    <span class="ps-plan-search-shift">${escapeHtml(manualShiftLabel(entry.monthsAdvanced))}</span>
  </td>`;
  }
  if (!entry.moved) {
    return `<td class="ps-plan-search-date ps-plan-search-date--unchanged">${escapeHtml(formatDateFr(entry.smoothedIso))}</td>`;
  }
  const pulledNote = entry.pulledFor
    ? `<span class="ps-plan-search-note">${escapeHtml(`avancé pour libérer l'armature ${entry.pulledFor}`)}</span>`
    : "";
  return `<td class="ps-plan-search-date ps-plan-search-date--moved">
    <strong>${escapeHtml(formatDateFr(entry.smoothedIso))}</strong>
    <span class="ps-plan-search-shift">${escapeHtml(`${entry.monthsAdvanced} mois plus tôt`)}</span>
    ${pulledNote}
  </td>`;
}

// Cellule « Date manuelle » (fenetre « Choisir les plans »).
// « N° 103 » ; sans N°, le nom du plan.
function planRef(entry) {
  const id2 = String(entry.id2 ?? "").trim();
  return id2 ? `N° ${id2}` : String(entry.name ?? "").trim() || "sans N°";
}

function renderManualCell(entry, manual) {
  if (entry.realized) {
    return '<td class="ps-plan-pick-cell"><span class="ps-plan-search-note">réalisé, ne bouge pas</span></td>';
  }
  const rowId = entry.rowId;
  const value = rowId == null ? "" : String(manual.dates?.[rowId] ?? "");
  if (manual.readOnly || rowId == null) {
    return `<td class="ps-plan-pick-cell ps-plan-search-date">${escapeHtml(value ? formatDateFr(value) : "—")}</td>`;
  }
  const clearButton = value
    ? `<button type="button" class="ps-plan-pick-clear" data-manual-clear="${escapeHtml(rowId)}" aria-label="${escapeHtml(`Effacer la date manuelle, ${planRef(entry)}`)}" title="Effacer la date manuelle">✕</button>`
    : "";
  return `<td class="ps-plan-pick-cell"><input type="date" class="ps-plan-pick-date" data-manual-row="${escapeHtml(rowId)}" value="${escapeHtml(value)}" min="${escapeHtml(manual.minIso || "")}" aria-label="${escapeHtml(`Date manuelle, ${planRef(entry)}`)}">${clearButton}</td>`;
}

// Une ligne par plan. Un plan realise est en vert (classe is-realized), comme
// une ligne realisee de la liste des taches du mois.
function renderRow(entry, active, manual) {
  const realizedTitle = entry.realized ? ' title="Plan réalisé"' : "";
  return `<tr class="ps-plan-search-row${entry.realized ? " is-realized" : ""}"${realizedTitle}>
    <td class="ps-plan-search-number">${escapeHtml(entry.id2)}</td>
    <td class="ps-plan-search-plan">
      <span class="ps-plan-search-name">${escapeHtml(entry.name)}</span>
      ${entry.place ? `<span class="ps-plan-search-place">${escapeHtml(entry.place)}</span>` : ""}
      ${entry.closureNote ? `<span class="ps-plan-search-note">${escapeHtml(entry.closureNote)}</span>` : ""}
    </td>
    <td class="ps-plan-search-type">
      <span class="ps-plan-search-dot" style="background:${escapeHtml(entry.typeColor)}"></span>${escapeHtml(entry.typeLabel)}
    </td>
    <td class="ps-plan-search-date">${escapeHtml(formatDateFr(entry.dueIso))}</td>
    ${active ? renderSmoothedCell(entry) : ""}
    <td class="ps-plan-search-progress">${escapeHtml(entry.progressLabel)}</td>
    ${manual ? renderManualCell(entry, manual) : ""}
  </tr>`;
}

// { entries, active, manual } -> HTML du tableau des resultats (ou message vide).
// manual (facultatif) ajoute la colonne « Date manuelle » :
// { dates: {rowId: iso}, minIso, readOnly }.
export function renderPlanSearchResults({ entries, active, manual = null }) {
  const list = entries || [];
  if (!list.length) return renderEmpty(NO_MATCH_TEXT);

  return `<table class="ps-plan-search-table">
    <thead>
      <tr>
        <th scope="col">N°</th>
        <th scope="col">Plan</th>
        <th scope="col">Type</th>
        <th scope="col">${active ? "Échéance sans lissage" : "Échéance"}</th>
        ${active ? '<th scope="col">Échéance lissée</th>' : ""}
        <th scope="col" class="ps-plan-search-progress">Avancement</th>
        ${manual ? '<th scope="col">Date manuelle</th>' : ""}
      </tr>
    </thead>
    <tbody>${list.map((entry) => renderRow(entry, active, manual)).join("")}</tbody>
  </table>`;
}

function lissageText(model) {
  if (model.active) {
    const movedCount = model.entries.filter((entry) => entry.moved).length;
    const manualCount = model.entries.filter((entry) => entry.manual).length;
    const manualText = manualCount > 0 ? ` · ${plural(manualCount, "date manuelle", "dates manuelles")}` : "";
    return `Lissage du service ${model.service} : ${plural(movedCount, "plan avancé", "plans avancés")}${manualText}.`;
  }
  return `Pas de lissage pour le service ${model.service} : les échéances sont celles du planning.`;
}

// --- controleur DOM -------------------------------------------------------------

// rootEl = #ps-plan-search-modal, ou #ps-plan-pick-modal (fenetre « Choisir les
// plans », meme balisage et autre prefixe). Elements internes (par id, prefixe
// idPrefix, « ps-plan-search » par defaut) : subtitle, number, name, zone, type,
// status, summary, lissage, reset, results, close, et done (facultatif : ferme).
//
// Modele (open / update) : { subtitle, service, active, entries, manual? }
// (entries : buildPlanSearchEntries). update() garde la recherche saisie ; une
// zone ou un type qui n'existe plus revient a « tous ». manual
// ({ dates, minIso, readOnly }) ajoute la colonne « Date manuelle ».
//
// Mode choix : si onManualDateChange est une fonction, un `input` sur une case
// date l'appelle avec (rowId, "AAAA-MM-JJ"), un clic sur ✕ avec (rowId, "").
// Le tableau n'est PAS refait pendant la frappe, et un update() recu quand une
// case date a le focus attend le `focusout` : un rendu volerait le focus.
//
// Balisage absent (un index.html reste en cache sans ce bloc) : fenetre inerte,
// sans exception, comme top/monthTasksModal.js.
export function createPlanSearchModal(rootEl, { idPrefix = "ps-plan-search", onManualDateChange = null } = {}) {
  if (typeof HTMLElement === "undefined" || !(rootEl instanceof HTMLElement)) {
    return { open() {}, update() {}, close() {}, isOpen: () => false, destroy() {} };
  }

  const find = (suffix) => rootEl.querySelector(`#${idPrefix}-${suffix}`);
  const inputs = {
    number: find("number"),
    name: find("name"),
    zone: find("zone"),
    type: find("type"),
    status: find("status"),
  };
  const subtitleEl = find("subtitle");
  const summaryEl = find("summary");
  const lissageEl = find("lissage");
  const resultsEl = find("results");
  const resetBtn = find("reset");
  const closeBtn = find("close");
  const doneBtn = find("done");
  const choosing = typeof onManualDateChange === "function";
  let model = null;
  // Rendu du tableau differe parce qu'une case date avait le focus.
  let renderPending = false;
  let opened = false;
  // Element qui avait le focus a l'ouverture (la loupe) : il le retrouve a la
  // fermeture, s'il est encore dans la page.
  let returnFocusEl = null;

  function readFilters() {
    return Object.fromEntries(
      Object.entries(inputs).map(([key, input]) => [key, input ? input.value : ""])
    );
  }

  // Remplit une liste en gardant le choix courant s'il existe encore. Memes
  // options qu'au rendu precedent (relecture du meme projet) : rien n'est
  // reconstruit, sinon une liste que l'utilisateur a ouverte se refermerait.
  function fillSelect(select, options) {
    if (!(select instanceof HTMLSelectElement)) return;
    const signature = JSON.stringify(options);
    if (select.dataset.optionsSignature === signature) return;
    select.dataset.optionsSignature = signature;
    const current = select.value;
    select.innerHTML = options
      .map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
      .join("");
    select.value = options.some((option) => option.value === current) ? current : "";
  }

  function applyModel() {
    const { zones, types } = planFilterOptions(model.entries);
    fillSelect(inputs.zone, [
      { value: "", label: "Toutes les zones" },
      ...zones.map((zone) => ({ value: zone, label: zone })),
    ]);
    fillSelect(inputs.type, [{ value: "", label: "Tous les types" }, ...types]);
    fillSelect(inputs.status, [
      { value: "", label: "Tous les états" },
      { value: PLAN_STATUS.TODO, label: "À faire" },
      { value: PLAN_STATUS.DONE, label: "Réalisés" },
      ...(model.active ? [{ value: PLAN_STATUS.ADVANCED, label: "Avancés par le lissage" }] : []),
      ...(model.active && model.entries.some((entry) => entry.manual)
        ? [{ value: PLAN_STATUS.MANUAL, label: "Dates manuelles" }]
        : []),
    ]);
    if (subtitleEl) subtitleEl.textContent = model.subtitle || "";
    if (lissageEl) {
      lissageEl.textContent = lissageText(model);
      lissageEl.classList.toggle("is-active", Boolean(model.active));
    }
  }

  // Case date des resultats ?
  function isManualInput(node) {
    return Boolean(node?.dataset && node.dataset.manualRow !== undefined && node.tagName === "INPUT");
  }

  function renderResults() {
    if (!model || !resultsEl) return;
    renderPending = false;
    const entries = model.entries || [];
    if (!entries.length) {
      if (summaryEl) summaryEl.textContent = "";
      resultsEl.innerHTML = renderEmpty(`Aucun plan dans le planning de ce projet pour le service ${model.service}.`);
      return;
    }
    const matches = filterPlanEntries(entries, readFilters());
    if (summaryEl) {
      summaryEl.textContent = matches.length === entries.length
        ? plural(entries.length, "plan", "plans")
        : `${plural(matches.length, "plan", "plans")} sur ${entries.length}`;
    }
    resultsEl.innerHTML = renderPlanSearchResults({
      entries: matches,
      active: model.active,
      manual: model.manual || null,
    });
  }

  function render(nextModel) {
    model = nextModel || { subtitle: "", service: "", active: false, entries: [] };
    applyModel();
    const focused = typeof document !== "undefined" ? document.activeElement : null;
    if (resultsEl && isManualInput(focused) && resultsEl.contains(focused)) {
      renderPending = true;
      return;
    }
    renderResults();
  }

  function open(nextModel) {
    returnFocusEl = document.activeElement;
    render(nextModel);
    rootEl.style.display = "flex";
    rootEl.setAttribute("aria-hidden", "false");
    opened = true;
    inputs.number?.focus();
  }

  // Remplace les plans sans fermer ni rouvrir ; sans effet sur une fenetre fermee.
  function update(nextModel) {
    if (!opened) return;
    render(nextModel);
  }

  function close() {
    if (!opened) return;
    rootEl.style.display = "none";
    rootEl.setAttribute("aria-hidden", "true");
    opened = false;
    const target = returnFocusEl;
    returnFocusEl = null;
    // Le focus ne doit pas rester dans un champ cache : il revient a la loupe,
    // ou, si elle ne l'avait pas (clic sans focus, Safari), il quitte la fenetre.
    if (target?.isConnected && target !== document.body) target.focus();
    else if (rootEl.contains(document.activeElement)) document.activeElement.blur();
  }

  function isOpen() {
    return opened;
  }

  function reset() {
    Object.values(inputs).forEach((input) => {
      if (input) input.value = "";
    });
    renderResults();
    inputs.number?.focus();
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape" || !opened) return;
    event.preventDefault();
    close();
  }

  // Frappe dans une case date : on previent le proprietaire, sans refaire le
  // tableau. Toute autre saisie (recherche, filtres) relance l'affichage.
  function handleInput(event) {
    if (isManualInput(event.target)) {
      if (choosing) onManualDateChange(Number(event.target.dataset.manualRow), event.target.value);
      return;
    }
    renderResults();
  }

  function handleClick(event) {
    const target = event.target;
    const clear = typeof target?.closest === "function" ? target.closest("[data-manual-clear]") : null;
    if (clear && choosing) {
      onManualDateChange(Number(clear.dataset.manualClear), "");
      return;
    }
    handleBackdropClick(event);
  }

  // Le focus quitte la case date : le rendu differe est applique, sauf si le
  // focus passe a un autre controle du tableau (le bouton d'effacement, une autre case), que
  // l'on ne veut pas remplacer entre le mouseup et le clic.
  function handleFocusOut(event) {
    if (!renderPending) return;
    const next = event.relatedTarget;
    if (next && resultsEl?.contains(next)) return;
    renderResults();
  }

  function handleBackdropClick(event) {
    if (event.target === rootEl) close();
  }

  // Entree dans un champ : la recherche est deja a jour, rien a envoyer.
  function handleSubmit(event) {
    event.preventDefault();
  }

  // `input` suffit : les listes et le bouton d'effacement des champs de
  // recherche le declenchent aussi.
  rootEl.addEventListener("input", handleInput);
  rootEl.addEventListener("submit", handleSubmit);
  rootEl.addEventListener("click", handleClick);
  resultsEl?.addEventListener("focusout", handleFocusOut);
  closeBtn?.addEventListener("click", close);
  doneBtn?.addEventListener("click", close);
  resetBtn?.addEventListener("click", reset);
  document.addEventListener("keydown", handleKeyDown);

  function destroy() {
    close();
    rootEl.removeEventListener("input", handleInput);
    rootEl.removeEventListener("submit", handleSubmit);
    rootEl.removeEventListener("click", handleClick);
    resultsEl?.removeEventListener("focusout", handleFocusOut);
    closeBtn?.removeEventListener("click", close);
    doneBtn?.removeEventListener("click", close);
    resetBtn?.removeEventListener("click", reset);
    document.removeEventListener("keydown", handleKeyDown);
  }

  return { open, update, close, isOpen, destroy };
}
