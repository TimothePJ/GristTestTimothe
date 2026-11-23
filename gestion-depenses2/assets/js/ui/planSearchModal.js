// Fenetre « Rechercher un plan » (loupe du graphique des depenses).
//
// Lecture seule : on cherche un plan du projet affiche par son N°, son nom ou
// les deux, on filtre par zone, type de document et etat, et chaque resultat
// donne son echeance sans lissage et, quand le service a un lissage, son
// echeance lissee. Les donnees viennent de utils/planSearch.js (calcul de
// planning-synchro). La charpente de la fenetre est dans index.html
// (#plan-search-modal).
//
// Les libelles reprennent ceux de la liste des taches du mois de
// planning-synchro (top/monthTasksModal.js) : « réalisation forcée le … »,
// « avancé pour libérer l'armature N° … », lignes realisees en vert.
import { formatDateFr } from "../../../../planning-synchro/assets/js/top/taskLabels.js";
import { filterPlans, getPlanFilterOptions, PLAN_STATUS } from "../utils/planSearch.js";
import { closeModal, openModal } from "./summary.js";

const NO_MATCH_TEXT =
  "Aucun plan ne correspond à cette recherche. Modifiez le N°, le nom ou les filtres.";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

// « Zone A · Groupe 3 », comme la liste des taches du mois de planning-synchro.
function placeOf(plan) {
  const parts = [];
  if (plan.zone) parts.push(plan.zone);
  if (plan.groupe) parts.push(`Groupe ${plan.groupe}`);
  return parts.join(" · ");
}

function renderEmpty(text) {
  return `<p class="plan-search-empty">${escapeHtml(text)}</p>`;
}

function renderSmoothedCell(plan) {
  if (!plan.moved) {
    return `<td class="plan-search-date plan-search-date--unchanged">${escapeHtml(formatDateFr(plan.smoothedIso))}</td>`;
  }
  const pulledNote = plan.pulledFor == null
    ? ""
    : `<span class="plan-search-note">avancé pour libérer l'armature ${escapeHtml(
        plan.pulledFor ? `N° ${plan.pulledFor}` : "liée"
      )}</span>`;
  return `<td class="plan-search-date plan-search-date--moved">
    <strong>${escapeHtml(formatDateFr(plan.smoothedIso))}</strong>
    <span class="plan-search-shift">${escapeHtml(`${plan.monthsAdvanced} mois plus tôt`)}</span>
    ${pulledNote}
  </td>`;
}

function renderRow(plan, lissageActive) {
  const place = placeOf(plan);
  const closureNote = plan.closureLabel
    ? `<span class="plan-search-note">${escapeHtml(`réalisation forcée le ${plan.closureLabel}`)}</span>`
    : "";
  const realizedTitle = plan.realized ? ' title="Plan réalisé"' : "";

  return `<tr class="plan-search-row${plan.realized ? " is-realized" : ""}"${realizedTitle}>
    <td class="plan-search-number">${escapeHtml(plan.number)}</td>
    <td class="plan-search-plan">
      <span class="plan-search-name">${escapeHtml(plan.name)}</span>
      ${place ? `<span class="plan-search-place">${escapeHtml(place)}</span>` : ""}
      ${closureNote}
    </td>
    <td class="plan-search-type">
      <span class="plan-search-type-dot" style="background:${escapeHtml(plan.typeColor)}"></span>${escapeHtml(plan.typeLabel)}
    </td>
    <td class="plan-search-date">${escapeHtml(formatDateFr(plan.dueIso))}</td>
    ${lissageActive ? renderSmoothedCell(plan) : ""}
    <td class="plan-search-progress">${escapeHtml(`${plan.progress} %`)}</td>
  </tr>`;
}

// { plans, lissageActive } -> HTML du tableau des resultats (ou message vide).
// Toutes les valeurs des plans sont echappees.
export function renderPlanSearchResults({ plans, lissageActive }) {
  const list = plans || [];
  if (!list.length) {
    return renderEmpty(NO_MATCH_TEXT);
  }

  return `<table class="plan-search-table">
    <thead>
      <tr>
        <th scope="col">N°</th>
        <th scope="col">Plan</th>
        <th scope="col">Type</th>
        <th scope="col">${lissageActive ? "Échéance sans lissage" : "Échéance"}</th>
        ${lissageActive ? '<th scope="col">Échéance lissée</th>' : ""}
        <th scope="col" class="plan-search-progress">Avancement</th>
      </tr>
    </thead>
    <tbody>${list.map((plan) => renderRow(plan, lissageActive)).join("")}</tbody>
  </table>`;
}

function renderOptions(options) {
  return options
    .map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
}

// Remplit une liste en gardant le choix courant s'il existe encore (meme
// projet relu), sinon revient a « tous ».
function fillSelect(select, options) {
  if (!(select instanceof HTMLSelectElement)) return;
  const current = select.value;
  select.innerHTML = renderOptions(options);
  select.value = options.some((option) => option.value === current) ? current : "";
}

function lissageTextOf(data) {
  if (!data) return "";
  if (data.lissageActive) {
    return `Lissage du service ${data.service} : ${plural(data.movedCount, "plan avancé", "plans avancés")}.`;
  }
  return `Pas de lissage pour le service ${data.service} : les échéances sont celles du planning.`;
}

// root : #plan-search-modal ; getData() -> resultat de buildPlanSearchData pour
// le projet affiche, ou null sans projet.
export function createPlanSearchModal({ root, getData }) {
  const find = (id) => root?.querySelector(`#${id}`) || null;
  const inputs = {
    number: find("plan-search-number"),
    name: find("plan-search-name"),
    zone: find("plan-search-zone"),
    type: find("plan-search-type"),
    status: find("plan-search-status"),
  };
  const subtitleEl = find("plan-search-subtitle");
  const summaryEl = find("plan-search-summary");
  const lissageEl = find("plan-search-lissage");
  const resultsEl = find("plan-search-results");
  let data = null;
  // Element qui avait le focus a l'ouverture (la loupe) : il le retrouve a la
  // fermeture, s'il est encore dans la page.
  let returnFocusEl = null;

  const isOpen = () => Boolean(root && !root.hidden);

  function readFilters() {
    return Object.fromEntries(
      Object.entries(inputs).map(([key, input]) => [key, input ? input.value : ""])
    );
  }

  function applyData() {
    const plans = data?.plans || [];
    const { zones, types } = getPlanFilterOptions(plans);
    fillSelect(inputs.zone, [
      { value: "", label: "Toutes les zones" },
      ...zones.map((zone) => ({ value: zone, label: zone })),
    ]);
    fillSelect(inputs.type, [{ value: "", label: "Tous les types" }, ...types]);
    fillSelect(inputs.status, [
      { value: "", label: "Tous les états" },
      { value: PLAN_STATUS.TODO, label: "À faire" },
      { value: PLAN_STATUS.DONE, label: "Réalisés" },
      ...(data?.lissageActive ? [{ value: PLAN_STATUS.ADVANCED, label: "Avancés par le lissage" }] : []),
    ]);

    if (subtitleEl) {
      subtitleEl.textContent = data ? `${data.projectName}, service ${data.service}` : "";
    }
    if (lissageEl) {
      lissageEl.textContent = lissageTextOf(data);
      lissageEl.classList.toggle("is-active", Boolean(data?.lissageActive));
    }
  }

  function renderResults() {
    if (!resultsEl) return;
    const plans = data?.plans || [];
    if (!plans.length) {
      if (summaryEl) summaryEl.textContent = "";
      resultsEl.innerHTML = renderEmpty(
        data
          ? `Aucun plan dans le planning de ce projet pour le service ${data.service}.`
          : "Choisissez un projet pour rechercher ses plans."
      );
      return;
    }

    const matches = filterPlans(plans, readFilters());
    if (summaryEl) {
      summaryEl.textContent = matches.length === plans.length
        ? plural(plans.length, "plan", "plans")
        : `${plural(matches.length, "plan", "plans")} sur ${plans.length}`;
    }
    resultsEl.innerHTML = renderPlanSearchResults({ plans: matches, lissageActive: data.lissageActive });
  }

  function reload() {
    data = typeof getData === "function" ? getData() : null;
    applyData();
    renderResults();
  }

  function open() {
    if (!root) return;
    returnFocusEl = typeof document !== "undefined" ? document.activeElement : null;
    reload();
    root.setAttribute("aria-hidden", "false");
    openModal(root);
    inputs.number?.focus();
  }

  function close() {
    if (!root) return;
    closeModal(root);
    root.setAttribute("aria-hidden", "true");
    if (returnFocusEl?.isConnected) returnFocusEl.focus();
    returnFocusEl = null;
  }

  function reset() {
    Object.values(inputs).forEach((input) => {
      if (input) input.value = "";
    });
    renderResults();
    inputs.number?.focus();
  }

  if (root) {
    // Entree dans un champ : la recherche est deja a jour, rien a envoyer.
    root.addEventListener("submit", (event) => event.preventDefault());
    root.addEventListener("input", renderResults);
    root.addEventListener("change", renderResults);
    root.addEventListener("click", (event) => {
      // Clic sur le fond assombri : la fenetre se ferme, comme les autres.
      if (event.target === root) {
        close();
        return;
      }
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (button?.id === "plan-search-close-btn") close();
      if (button?.id === "plan-search-reset-btn") reset();
    });
    // La charpente arrive masquee par son style, sans `hidden` : sans cette
    // fermeture, isOpen() vaudrait vrai au demarrage (Echap la fermerait avant
    // les autres fenetres, et chaque rendu la recalculerait).
    close();
  }

  return {
    open,
    close,
    isOpen,
    // Donnees relues (projet, service ou tables changes) : la fenetre ouverte
    // suit, en gardant la recherche saisie.
    refresh() {
      if (isOpen()) reload();
    },
  };
}
