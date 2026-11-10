// Fenetre « Taches du mois » de planning-synchro (#ps-month-tasks-modal, §6.4 de
// la spec du lissage). Un clic sur le graphique des taches (top/planningChart.js,
// onBucketClick) l'ouvre sur la liste des taches du seau (mois ou semaine) situe
// sous le pointeur, filtree par les types coches. Les fleches < > de l'en-tete
// (et les touches ← →) passent au seau voisin sans fermer la fenetre
// (shiftBucket) ; le controleur du lissage recalcule alors la liste.
//
// Lecture seule : aucune ecriture Grist, aucun bouton d'action.
//
// Meme decoupage que bottom/chargeAssignModal.js : un modele PUR
// (buildBucketTaskList, aucun DOM, teste dans tests/monthTasksModal.test.mjs)
// puis un controleur DOM (createMonthTasksModal) qui n'en rend que le resultat.
// Tout texte venant d'une tache est echappe avant d'entrer dans le HTML.

import {
  OVERFLOW_REASON_LABELS,
  TYPE_META,
  TYPE_ORDER,
  formatDateFr,
  formatMonthLabel,
  formatWeekLabel,
} from "./taskLabels.js";
import { monthMaxima } from "./taskSmoothing.js";

// --- modele pur (aucun DOM) -----------------------------------------------------

const MODE_LABELS = { raw: "non lissé", smoothed: "lissé", both: "les deux" };

const EMPTY_TEXT = "Aucune tâche à réaliser sur cette période.";

// Vrai si `iso` ∈ [startIso, endIso) (comparaison lexicographique : AAAA-MM-JJ).
function inBucket(iso, bucket) {
  const value = String(iso ?? "");
  return value !== "" && value >= bucket.startIso && value < bucket.endIso;
}

// Le seau est un MOIS entier quand il commence un 1er et finit le 1er du mois
// suivant. Les depassements (§4.7) sont rapportes par mois : ils ne s'affichent
// que pour un seau mensuel, pas pour une semaine.
function isMonthlyBucket(bucket) {
  const start = /^(\d{4})-(\d{2})-01$/.exec(String(bucket.startIso ?? ""));
  if (!start) return false;
  const year = Number(start[1]);
  const month = Number(start[2]);
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return bucket.endIso === next;
}

// Granularite d'un seau : celle que le graphique a posee (bucket.granularity),
// sinon deduite des bornes.
function granularityOf(bucket) {
  if (bucket?.granularity === "month" || bucket?.granularity === "week") return bucket.granularity;
  return isMonthlyBucket(bucket || {}) ? "month" : "week";
}

// Libelles des fleches de l'en-tete, selon la granularite du seau.
const NAV_TITLES = {
  month: { previous: "Mois précédent", next: "Mois suivant" },
  week: { previous: "Semaine précédente", next: "Semaine suivante" },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, "0");
}

// "AAAA-MM-JJ" -> minuit UTC de ce jour, ou null. Les calculs de jours se font
// en UTC : un decalage d'une semaine ne traverse jamais un changement d'heure.
function utcOfIso(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function isoOfUtc(ms) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// Indice de mois absolu (annee * 12 + mois 0-11) -> "AAAA-MM-01".
function monthStartIso(monthIndex) {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  return `${year}-${pad2(month + 1)}-01`;
}

// Seau voisin d'un seau de la fenetre : step = -1 (precedent) ou +1 (suivant),
// tout entier accepte. Seau mensuel -> le mois decale, du 1er au 1er du mois
// suivant ; seau hebdomadaire -> la semaine decalee de 7 jours par pas. Le
// libelle suit (formatMonthLabel / formatWeekLabel, ceux du clic sur le
// graphique) ; granularite et types coches sont gardes. Aucune borne : un mois
// sans tache affiche simplement la liste vide. Seau illisible ou pas nul ->
// le seau tel quel.
export function shiftBucket(bucket, step) {
  const start = utcOfIso(bucket?.startIso);
  const offset = Math.trunc(Number(step));
  if (start == null || !Number.isFinite(offset) || offset === 0) return bucket;
  const granularity = granularityOf(bucket);
  const visibleTypeKeys = Array.isArray(bucket.visibleTypeKeys) ? bucket.visibleTypeKeys.slice() : [];
  if (granularity === "week") {
    const startMs = start + offset * 7 * DAY_MS;
    const startIso = isoOfUtc(startMs);
    return {
      startIso,
      endIso: isoOfUtc(startMs + 7 * DAY_MS),
      label: formatWeekLabel(startIso),
      granularity,
      visibleTypeKeys,
    };
  }
  const startDate = new Date(start);
  const monthIndex = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth() + offset;
  const startIso = monthStartIso(monthIndex);
  return {
    startIso,
    endIso: monthStartIso(monthIndex + 1),
    label: formatMonthLabel(startIso.slice(0, 7)),
    granularity,
    visibleTypeKeys,
  };
}

function compareById(a, b) {
  return String(a.id2 ?? "").localeCompare(String(b.id2 ?? ""), "fr", { numeric: true });
}

function monthKeyOf(iso) {
  return String(iso ?? "").slice(0, 7);
}

// Les trois libelles ci-dessous sont exportes pour la fenetre « Rechercher un
// plan » (top/planSearchModal.js) : une tache s'y lit dans les memes mots.

// « 67 % » : avancement de la tache, celui de la colonne « Realise » de Planning
// Projet (ChartTask.progress) ; sans valeur connue, 0 %.
export function progressLabelOf(task) {
  const value = Number(task.progress);
  return `${Number.isFinite(value) ? value : 0} %`;
}

// Libelle « Zone A · Groupe 3 » (parties vides omises).
export function placeOf(task) {
  const parts = [];
  if (String(task.zone ?? "").trim()) parts.push(String(task.zone).trim());
  if (String(task.groupe ?? "").trim()) parts.push(`Groupe ${String(task.groupe).trim()}`);
  return parts.join(" · ");
}

// « N° 145 » pour un coffrage entraine par une armature. `pulledFor` porte l'id2
// de l'armature (SmoothedTask), qui peut etre vide : on retombe alors sur le nom
// d'une armature du meme groupe dont l'id2 est vide, sinon « N° ? ».
export function pulledForLabel(task, allTasks) {
  if (task.pulledFor == null) return null;
  const id2 = String(task.pulledFor).trim();
  if (id2 !== "") return `N° ${id2}`;
  const armature = allTasks.find(
    (other) =>
      other.type === "ARMATURES" &&
      String(other.id2 ?? "").trim() === "" &&
      String(other.groupKey ?? "") === String(task.groupKey ?? "") &&
      String(other.name ?? "").trim() !== ""
  );
  return armature ? String(armature.name).trim() : "N° ?";
}

// Depassement du mois pour une serie ("TOTAL" ou un type) -> { count, max, reason } | null.
function findOverflow(result, monthKey, series) {
  const list = Array.isArray(result?.overflows) ? result.overflows : [];
  return list.find((entry) => entry.month === monthKey && entry.series === series) || null;
}

// « de » + libelle, elide devant une voyelle (accents compris) : « d'avril
// 2027 », « d'août 2027 », « d'octobre 2027 », mais « de mars 2027 ».
export function de(label) {
  const text = String(label ?? "");
  const first = text.charAt(0).normalize("NFD").replace(/\p{M}/gu, "");
  return /^[aeiou]$/i.test(first) ? `d'${text}` : `de ${text}`;
}

function overflowText(entry, prefix) {
  const reason = OVERFLOW_REASON_LABELS[entry.reason] || entry.reason;
  return `${prefix} : ${entry.count} / ${entry.max} — ${reason}`;
}

// { result, mode, bucket, visibleTypeKeys, settings } -> modele de la fenetre.
//   mode : "raw" (non lisse) | "smoothed" (lisse) | "both" (les deux)
//   visibleTypeKeys : types coches ; [] = tous
//   settings : { maxTotal, maxByType, maxByMonth? } (voir top/smoothingSettings.js) ;
//              le « n / max » d'un type prend le maximum du mois du seau
//              (celui du mois precis s'il existe)
export function buildBucketTaskList({ result, mode, bucket, visibleTypeKeys, settings }) {
  const effectiveMode = MODE_LABELS[mode] ? mode : "raw";
  const modeLabel = MODE_LABELS[effectiveMode];
  const allTasks = Array.isArray(result?.tasks) ? result.tasks : [];
  const showSmoothed = effectiveMode !== "raw";
  const wanted = Array.isArray(visibleTypeKeys) && visibleTypeKeys.length ? new Set(visibleTypeKeys) : null;
  const typeKeys = TYPE_ORDER.filter((key) => !wanted || wanted.has(key));
  const monthly = isMonthlyBucket(bucket);
  const monthKey = monthKeyOf(bucket.startIso);
  const maxByType = monthMaxima(settings, monthKey).maxByType;
  const hasLimits = Boolean(result?.active);

  const dateOf = (task) => (showSmoothed ? task.smoothedIso : task.dueIso);

  const sections = [];
  typeKeys.forEach((type) => {
    const tasks = allTasks
      .filter((task) => task.type === type && inBucket(dateOf(task), bucket))
      .sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b))) || compareById(a, b));
    if (!tasks.length) return;

    const items = tasks.map((task) => ({
      rowId: task.rowId,
      dateLabel: formatDateFr(dateOf(task)),
      id2: String(task.id2 ?? ""),
      name: String(task.name ?? ""),
      place: placeOf(task),
      realized: Boolean(task.realized),
      progressLabel: progressLabelOf(task),
      closureNote: task.closureLabel ? `réalisation forcée le ${task.closureLabel}` : null,
      movedFrom:
        showSmoothed && task.moved
          ? `${formatMonthLabel(monthKeyOf(task.dueIso))} (${formatDateFr(task.dueIso)})`
          : null,
      pulledFor: showSmoothed ? pulledForLabel(task, allTasks) : null,
      manualNote: showSmoothed && task.manual ? `date manuelle (échéance ${formatDateFr(task.dueIso)})` : null,
    }));

    const max = hasLimits && monthly && maxByType[type] != null ? maxByType[type] : null;
    const overflow = monthly ? findOverflow(result, monthKey, type) : null;
    sections.push({
      type,
      label: TYPE_META[type].label,
      color: TYPE_META[type].color,
      countLabel: max != null ? `${items.length} / ${max}` : String(items.length),
      warning: overflow ? overflowText(overflow, "Dépassement") : null,
      items,
    });
  });

  const totalOverflow = monthly ? findOverflow(result, monthKey, "TOTAL") : null;

  const departed =
    effectiveMode === "both"
      ? allTasks
          .filter(
            (task) =>
              (!wanted || wanted.has(task.type)) &&
              inBucket(task.dueIso, bucket) &&
              !inBucket(task.smoothedIso, bucket)
          )
          .sort((a, b) => String(a.dueIso).localeCompare(String(b.dueIso)) || compareById(a, b))
          .map((task) => ({
            id2: String(task.id2 ?? ""),
            name: String(task.name ?? ""),
            toMonthLabel: formatMonthLabel(monthKeyOf(task.smoothedIso)),
          }))
      : [];

  const navTitles = NAV_TITLES[granularityOf(bucket)];
  return {
    title: `Tâches à réaliser — ${bucket.label} · ${modeLabel}`,
    modeLabel,
    previousTitle: navTitles.previous,
    nextTitle: navTitles.next,
    banner: totalOverflow ? overflowText(totalOverflow, "Dépassement du total") : null,
    flat: sections.length <= 1,
    sections,
    departed,
    empty: sections.length === 0,
  };
}

// --- rendu HTML ---------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Une ligne par tache : date, N°, nom, lieu et pourcentage d'avancement (comme
// la colonne « Realise » de Planning Projet). Une tache realisee est en vert
// (classe is-realized), comme une ligne realisee de Planning Projet.
function renderItem(item) {
  const secondary = [];
  if (item.closureNote) secondary.push(item.closureNote);
  if (item.movedFrom) secondary.push(`avancée ${de(item.movedFrom)}`);
  if (item.pulledFor) secondary.push(`avancé pour libérer l'armature ${item.pulledFor}`);
  if (item.manualNote) secondary.push(item.manualNote);
  const realizedTitle = item.realized ? ' title="Tâche réalisée"' : "";
  return `<li class="ps-month-tasks-item${item.realized ? " is-realized" : ""}"${realizedTitle}>
    <div class="ps-month-tasks-row">
      <span class="ps-month-tasks-date">${escapeHtml(item.dateLabel)}</span>
      <span class="ps-month-tasks-id">${item.id2 ? `N° ${escapeHtml(item.id2)}` : ""}</span>
      <span class="ps-month-tasks-name">${escapeHtml(item.name)}</span>
      <span class="ps-month-tasks-place">${escapeHtml(item.place)}</span>
      <span class="ps-month-tasks-progress">${escapeHtml(item.progressLabel)}</span>
    </div>
    ${secondary.length ? `<div class="ps-month-tasks-note">${escapeHtml(secondary.join(" · "))}</div>` : ""}
  </li>`;
}

// Un seul type : liste simple (classe --flat, sans pastille de section) ; la
// ligne de titre garde le compte, qui porte le « n / max » du lissage.
function renderSection(section, flat) {
  const dot = flat ? "" : `<span class="ps-month-tasks-dot" style="background:${escapeHtml(section.color)}"></span>`;
  const head = `<h3 class="ps-month-tasks-section-head">${dot}${escapeHtml(section.label)} (${escapeHtml(section.countLabel)})</h3>`;
  const warning = section.warning
    ? `<p class="ps-month-tasks-warning">${escapeHtml(section.warning)}</p>`
    : "";
  return `<section class="ps-month-tasks-section">${head}${warning}<ul class="ps-month-tasks-list">${section.items
    .map(renderItem)
    .join("")}</ul></section>`;
}

function renderDeparted(departed) {
  if (!departed.length) return "";
  const rows = departed
    .map(
      (entry) =>
        `<li class="ps-month-tasks-item"><div class="ps-month-tasks-row"><span class="ps-month-tasks-id">${
          entry.id2 ? `N° ${escapeHtml(entry.id2)}` : ""
        }</span><span class="ps-month-tasks-name">${escapeHtml(entry.name)}</span><span class="ps-month-tasks-place">→ ${escapeHtml(
          entry.toMonthLabel
        )}</span></div></li>`
    )
    .join("");
  return `<section class="ps-month-tasks-section"><h3 class="ps-month-tasks-section-head">Parties plus tôt (${departed.length})</h3><ul class="ps-month-tasks-list">${rows}</ul></section>`;
}

function renderBody(model) {
  if (model.empty && !model.departed.length) {
    return `<p class="ps-month-tasks-empty">${EMPTY_TEXT}</p>`;
  }
  const sections = model.empty
    ? `<p class="ps-month-tasks-empty">${EMPTY_TEXT}</p>`
    : model.sections.map((section) => renderSection(section, model.flat)).join("");
  return sections + renderDeparted(model.departed);
}

// --- controleur DOM ---------------------------------------------------------------------

// rootEl = #ps-month-tasks-modal. Elements internes (par id) :
//   #ps-month-tasks-title, #ps-month-tasks-banner, #ps-month-tasks-body,
//   #ps-month-tasks-close, #ps-month-tasks-prev, #ps-month-tasks-next.
//
// options.onNavigate(step) : appele par les fleches < > (step -1 / +1) et par
// les touches ← → quand la fenetre est ouverte ; l'appelant recalcule le seau
// voisin (shiftBucket) et repasse le modele par update(). Sans onNavigate, les
// fleches sont masquees. Les touches sont ignorees avec Alt / Ctrl / Maj / Cmd
// (Alt+← est le retour du navigateur) et dans un champ de saisie.
//
// Balisage absent (un index.html reste en cache sans ce bloc) : fenetre inerte,
// sans exception — le controleur du lissage la cree au demarrage du widget, et
// une exception ici laisserait tout le widget blanc. Meme garde que
// bottom/chargeAssignModal.js.
export function createMonthTasksModal(rootEl, { onNavigate = null } = {}) {
  if (typeof HTMLElement === "undefined" || !(rootEl instanceof HTMLElement)) {
    return { open() {}, update() {}, close() {}, isOpen: () => false, destroy() {} };
  }

  const titleEl = rootEl.querySelector("#ps-month-tasks-title");
  const bannerEl = rootEl.querySelector("#ps-month-tasks-banner");
  const bodyEl = rootEl.querySelector("#ps-month-tasks-body");
  const closeBtn = rootEl.querySelector("#ps-month-tasks-close");
  const prevBtn = rootEl.querySelector("#ps-month-tasks-prev");
  const nextBtn = rootEl.querySelector("#ps-month-tasks-next");
  const canNavigate = typeof onNavigate === "function";
  let opened = false;

  [prevBtn, nextBtn].forEach((button) => {
    if (button) button.hidden = !canNavigate;
  });

  function setNavTitle(button, text) {
    if (!button || !text) return;
    button.title = text;
    button.setAttribute("aria-label", text);
  }

  function render(model) {
    if (titleEl) titleEl.textContent = model.title;
    if (bannerEl) {
      bannerEl.textContent = model.banner || "";
      bannerEl.hidden = !model.banner;
    }
    if (bodyEl) bodyEl.innerHTML = renderBody(model);
    setNavTitle(prevBtn, model.previousTitle);
    setNavTitle(nextBtn, model.nextTitle);
  }

  function open(model) {
    render(model);
    rootEl.style.display = "flex";
    opened = true;
  }

  // Remplace le contenu sans fermer ni rouvrir ; sans effet sur une fenetre fermee.
  function update(model) {
    if (!opened) return;
    render(model);
  }

  function close() {
    rootEl.style.display = "none";
    opened = false;
  }

  function isOpen() {
    return opened;
  }

  // Seau voisin : la liste repart du haut (une mise a jour des donnees, elle,
  // garde le defilement).
  function navigate(step) {
    if (!opened || !canNavigate) return;
    onNavigate(step);
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  const handlePrevClick = () => navigate(-1);
  const handleNextClick = () => navigate(1);

  function isEditableTarget(target) {
    const tag = String(target?.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target?.isContentEditable);
  }

  function handleKeyDown(event) {
    if (!opened) return;
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (!canNavigate || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isEditableTarget(event.target)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    navigate(event.key === "ArrowLeft" ? -1 : 1);
  }

  function handleBackdropClick(event) {
    if (event.target === rootEl) close();
  }

  closeBtn?.addEventListener("click", close);
  prevBtn?.addEventListener("click", handlePrevClick);
  nextBtn?.addEventListener("click", handleNextClick);
  rootEl.addEventListener("click", handleBackdropClick);
  document.addEventListener("keydown", handleKeyDown);

  function destroy() {
    close();
    closeBtn?.removeEventListener("click", close);
    prevBtn?.removeEventListener("click", handlePrevClick);
    nextBtn?.removeEventListener("click", handleNextClick);
    rootEl.removeEventListener("click", handleBackdropClick);
    document.removeEventListener("keydown", handleKeyDown);
  }

  return { open, update, close, isOpen, destroy };
}
