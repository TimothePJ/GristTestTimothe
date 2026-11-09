// Fenetre « Lissage des taches » de planning-synchro (#ps-smoothing-modal, §6.2
// de la spec du lissage). Le bouton « Lisser… » du graphique l'ouvre ; elle
// permet de choisir le mois de depart (« Lisser a partir de », §4.8), de fixer
// un maximum general et un maximum par type de document pour tous les mois,
// puis de les remplacer pour des mois precis (« Mois particuliers »). La
// section « Plan particulier » impose la date de fin de plans precis en mode
// lisse (dates manuelles, spec 2026-11-09 §5.1 a §5.4), directement ou par la
// fenetre « Choisir les plans » (#ps-plan-pick-modal, top/planSearchModal.js)
// ouverte PAR-DESSUS celle-ci et pilotee d'ici. Elle montre l'effet du lissage
// en direct (apercu) et remet les reglages au controleur.
//
// La fenetre N'ECRIT RIEN elle-meme : elle appelle onSubmit(settings) ou
// onDelete(), fournis par le controleur (Tache 8), et affiche leur echec. Meme
// decoupage que bottom/chargeAssignModal.js : fonctions PURES (computeTypePeaks,
// buildPreviewRows, buildStartOptions, buildMonthChoices, buildManualPlanRows,
// buildPlanChoices, testees sans DOM) puis un controleur DOM
// (createSmoothingModal). Tout texte insere en HTML est echappe.

import { isMonthKey, parseMaxInput } from "./smoothingSettings.js";
import { monthKeyOf, smoothingStartMonth } from "./taskSmoothing.js";
import { compareChartTasks } from "./taskLoadModel.js";
import { firstAllowedManualIso, isIsoDate } from "./manualDates.js";
import { placeOf } from "./monthTasksModal.js";
import { buildPlanSearchEntries, createPlanSearchModal } from "./planSearchModal.js";
import {
  OVERFLOW_REASON_LABELS,
  TOTAL_META,
  TYPE_META,
  TYPE_ORDER,
  formatDateFr,
  formatMonthLabel,
} from "./taskLabels.js";

// --- fonctions pures (aucun DOM) ---------------------------------------------------

// Pic actuel de chaque type : plus grand nombre de taches (echeances d'ORIGINE)
// sur un mois a partir de fromIso (la fenetre passe aujourd'hui : les taches a
// venir ; AAAA-MM ou une date dont on prend le mois), et ce mois (le plus tot en
// cas d'egalite). Un type sans tache a partir de ce mois n'a pas d'entree.
export function computeTypePeaks(tasks, fromIso) {
  const currentMonth = monthKeyOf(fromIso);
  const counts = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const month = monthKeyOf(task.dueIso);
    if (!month || month < currentMonth) return;
    if (!counts.has(task.type)) counts.set(task.type, new Map());
    const perMonth = counts.get(task.type);
    perMonth.set(month, (perMonth.get(month) || 0) + 1);
  });
  const peaks = {};
  counts.forEach((perMonth, type) => {
    let best = null;
    [...perMonth.keys()].sort().forEach((month) => {
      const count = perMonth.get(month);
      if (!best || count > best.count) best = { count, monthKey: month };
    });
    peaks[type] = best;
  });
  return peaks;
}

// Lignes « Avant / Apres » de l'apercu : mois qui changent ou qui restent en
// depassement, du mois de depart (fromIso, comme computeTypePeaks) au dernier
// mois concerne. Tous types confondus.
export function buildPreviewRows(result, fromIso) {
  const currentMonth = monthKeyOf(fromIso);
  const before = new Map();
  const after = new Map();
  const bump = (map, month) => map.set(month, (map.get(month) || 0) + 1);
  (Array.isArray(result?.tasks) ? result.tasks : []).forEach((task) => {
    const dueMonth = monthKeyOf(task.dueIso);
    const smoothedMonth = monthKeyOf(task.smoothedIso || task.dueIso);
    if (dueMonth && dueMonth >= currentMonth) bump(before, dueMonth);
    if (smoothedMonth && smoothedMonth >= currentMonth) bump(after, smoothedMonth);
  });
  const overflowMonths = new Set(
    (Array.isArray(result?.overflows) ? result.overflows : []).map((entry) => entry.month)
  );
  const months = new Set([...before.keys(), ...after.keys(), ...overflowMonths]);
  return [...months]
    .sort()
    .filter((month) => month >= currentMonth)
    .map((month) => ({
      monthKey: month,
      label: formatMonthLabel(month),
      before: before.get(month) || 0,
      after: after.get(month) || 0,
      overflow: overflowMonths.has(month),
    }))
    .filter((row) => row.before !== row.after || row.overflow);
}

// Mois AAAA-MM <-> index (annee * 12 + mois - 1), pour parcourir les mois.
function monthIndexOfKey(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ""));
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : Number.NaN;
}

function monthKeyAt(index) {
  const year = Math.floor(index / 12);
  return `${year}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

// Mois des echeances d'origine, tries.
function dueMonthsOf(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => monthKeyOf(task.dueIso))
    .filter(Boolean)
    .sort();
}

// Recul de la liste « Lisser a partir de » avant la premiere echeance : des
// mois vides ou placer les taches a venir. 5 ans, comme la fenetre la plus
// large de la frise (config.viewport.maxVisibleDays).
const START_LEAD_MONTHS = 60;

// Choix du « Lisser a partir de » : le mois en cours (valeur "" : il suit le
// calendrier), puis chaque mois passe, du plus recent au plus ancien, jusqu'a
// START_LEAD_MONTHS mois avant la premiere echeance (ou avant le mois en cours
// s'il est plus tot) — et jusqu'au mois enregistre (selected) s'il est plus
// ancien.
export function buildStartOptions(tasks, todayIso, selected) {
  const current = monthKeyOf(todayIso);
  const options = [{ value: "", label: `Mois en cours (${formatMonthLabel(current)})` }];
  const firstDue = dueMonthsOf(tasks)[0];
  let earliest = monthIndexOfKey(firstDue && firstDue < current ? firstDue : current) - START_LEAD_MONTHS;
  if (isMonthKey(selected)) earliest = Math.min(earliest, monthIndexOfKey(selected));
  for (let index = monthIndexOfKey(current) - 1; index >= earliest; index -= 1) {
    const monthKey = monthKeyAt(index);
    options.push({ value: monthKey, label: formatMonthLabel(monthKey) });
  }
  return options;
}

// Mois proposes pour un maximum particulier : du mois de depart (startKey) au
// mois de la derniere echeance, sauf ceux deja ajoutes (excluded).
export function buildMonthChoices(tasks, startKey, excluded) {
  const dueMonths = dueMonthsOf(tasks);
  if (!dueMonths.length) return [];
  const skip = new Set(excluded || []);
  const choices = [];
  for (let index = monthIndexOfKey(startKey); index <= monthIndexOfKey(dueMonths.at(-1)); index += 1) {
    const monthKey = monthKeyAt(index);
    if (!skip.has(monthKey)) choices.push({ value: monthKey, label: formatMonthLabel(monthKey) });
  }
  return choices;
}

// Nombre de taches par mois d'echeance d'origine (realisees comprises).
function countByMonth(tasks) {
  const counts = new Map();
  dueMonthsOf(tasks).forEach((month) => counts.set(month, (counts.get(month) || 0) + 1));
  return counts;
}

// --- plan particulier (dates manuelles, spec 2026-11-09 §5.1) ----------------------

const hasKey = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

// Plan qui peut recevoir une date manuelle : non realise, avec une ligne Grist.
const isManualCandidate = (task) => Boolean(task) && !task.realized && task.rowId != null;

// « N mois plus tôt » / « N mois plus tard » / « même mois » : ecart entre la
// date manuelle et l'echeance sans lissage (monthsAdvanced < 0 = plus tard).
// Memes mots que la fenetre « Rechercher un plan ».
function manualShiftLabel(monthsAdvanced) {
  const months = Number(monthsAdvanced) || 0;
  if (months > 0) return `${months} mois plus tôt`;
  if (months < 0) return `${-months} mois plus tard`;
  return "même mois";
}

// « N° 12 » ; une armature sans N° est nommee.
function armatureLabel(task) {
  const id2 = String(task.id2 ?? "").trim();
  if (id2) return `N° ${id2}`;
  return String(task.name ?? "").trim() || "N° ?";
}

// Lignes du tableau « Plan particulier » : les plans non realises dont le
// rowId est dans la saisie (draftManual, { rowId: "AAAA-MM-JJ" | "" }), tries
// par date manuelle (les cases vides en dernier) puis dans l'ordre du
// graphique. note : l'ecart de mois du dernier apercu (result, SmoothingResult
// ou null) pour un plan fixe, puis, pour un coffrage, « après son armature N° … »
// pour chaque armature non realisee de son groupe dont la date lissee (a
// defaut l'echeance) est avant sa date manuelle (§4.3).
export function buildManualPlanRows({ tasks, draftManual, result } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const draft = draftManual || {};
  const smoothedByRow = new Map();
  (Array.isArray(result?.tasks) ? result.tasks : []).forEach((task) => {
    if (task?.rowId != null) smoothedByRow.set(String(task.rowId), task);
  });
  const smoothedIsoOf = (task) =>
    (task.rowId != null ? smoothedByRow.get(String(task.rowId))?.smoothedIso : null) || task.dueIso;

  return list
    .filter((task) => isManualCandidate(task) && hasKey(draft, String(task.rowId)))
    .map((task) => {
      const key = String(task.rowId);
      const value = String(draft[key] ?? "");
      const meta = TYPE_META[task.type] || TYPE_META.AUTRES;
      const parts = [];
      const smoothed = smoothedByRow.get(key);
      if (smoothed?.manual) parts.push(manualShiftLabel(smoothed.monthsAdvanced));
      if (task.type === "COFFRAGE" && task.groupKey && value) {
        list.forEach((other) => {
          if (other?.type !== "ARMATURES" || other.realized || other.groupKey !== task.groupKey) return;
          const date = smoothedIsoOf(other);
          if (date && date < value) parts.push(`après son armature ${armatureLabel(other)}`);
        });
      }
      return {
        task,
        row: {
          rowId: task.rowId,
          id2: String(task.id2 ?? "").trim(),
          name: String(task.name ?? "").trim(),
          place: placeOf(task),
          type: task.type,
          typeLabel: meta.label,
          typeColor: meta.color,
          dueIso: task.dueIso,
          value,
          note: parts.join(" · "),
        },
      };
    })
    .sort((left, right) => {
      const a = left.row.value;
      const b = right.row.value;
      if (a !== b) {
        if (!a) return 1;
        if (!b) return -1;
        return a < b ? -1 : 1;
      }
      return compareChartTasks(left.task, right.task);
    })
    .map((entry) => entry.row);
}

// Plans proposes par la liste « Plan à ajouter » : non realises, sans entree
// dans la saisie (draftManual), dans l'ordre des taches (celui du graphique).
export function buildPlanChoices(tasks, draftManual) {
  const draft = draftManual || {};
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => isManualCandidate(task) && !hasKey(draft, String(task.rowId)))
    .map((task) => {
      const id2 = String(task.id2 ?? "").trim();
      const name = String(task.name ?? "").trim();
      const zone = String(task.zone ?? "").trim();
      return { value: String(task.rowId), label: `${id2 ? `N° ${id2} — ` : ""}${name}${zone ? ` (${zone})` : ""}` };
    });
}

// --- rendu HTML ---------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function seriesLabel(series) {
  if (series === "TOTAL") return TOTAL_META.label;
  return TYPE_META[series]?.label || String(series ?? "");
}

function movedText(count) {
  if (count === 0) return "aucune tâche avancée";
  return count === 1 ? "1 tâche avancée" : `${count} tâches avancées`;
}

function manualCountText(count) {
  return count === 1 ? "1 date manuelle" : `${count} dates manuelles`;
}

// Le lissage ne retarde jamais une tache (regle 1) : seule une date manuelle
// placee apres l'echeance retarde un plan (delayedCount).
function delayedText(count) {
  if (!count) return NEVER_DELAYED_TEXT;
  return count === 1 ? "1 retardée par une date manuelle" : `${count} retardées par une date manuelle`;
}

const NEVER_DELAYED_TEXT = "aucune tâche retardée";
const INACTIVE_TEXT = "Aucun maximum défini : rien n'est lissé.";
const READ_ONLY_TEXT = "Lecture seule : le service affiché n'est pas votre service de rattachement.";

function renderPreview(result, fromIso) {
  if (!result || !result.active) {
    return `<p class="ps-smoothing-summary">${escapeHtml(INACTIVE_TEXT)}</p>`;
  }
  const overflows = Array.isArray(result.overflows) ? result.overflows : [];
  const manualCount = Number(result.manualCount) || 0;
  const summary = [
    movedText(result.movedCount),
    ...(manualCount > 0 ? [manualCountText(manualCount)] : []),
    delayedText(Number(result.delayedCount) || 0),
  ].join(" · ");
  let html = `<p class="ps-smoothing-summary">${escapeHtml(summary)}</p>`;

  if (overflows.length) {
    const title = overflows.length === 1 ? "1 dépassement reste" : `${overflows.length} dépassements restent`;
    const items = overflows
      .map((entry) => {
        const reason = OVERFLOW_REASON_LABELS[entry.reason] || entry.reason;
        return `<li>${escapeHtml(formatMonthLabel(entry.month))} — ${escapeHtml(seriesLabel(entry.series))} ${escapeHtml(
          entry.count
        )} / ${escapeHtml(entry.max)} : ${escapeHtml(reason)}</li>`;
      })
      .join("");
    html += `<p class="ps-smoothing-warning">⚠ ${escapeHtml(title)}</p><ul class="ps-smoothing-overflows">${items}</ul>`;
  }

  const rows = buildPreviewRows(result, fromIso);
  if (rows.length) {
    const body = rows
      .map(
        (row) =>
          `<tr${row.overflow ? ' class="is-overflow"' : ""}><th scope="row">${escapeHtml(row.label)}</th><td>${
            row.before
          }</td><td>${row.after}</td></tr>`
      )
      .join("");
    html += `<table class="ps-smoothing-table"><thead><tr><th scope="col">Mois</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  return html;
}

function peakText(peak) {
  if (!peak) return "pic actuel : aucune tâche à venir";
  return `pic actuel ${peak.count} (${formatMonthLabel(peak.monthKey)})`;
}

function renderTypeRows(types, draft, peaks, disabled) {
  return types
    .map((type) => {
      const meta = TYPE_META[type];
      const raw = draft.byType[type] ?? "";
      const invalid = !parseMaxInput(raw).ok;
      const inputId = `ps-smoothing-max-${type}`;
      return `<div class="ps-smoothing-row">
        <label class="ps-smoothing-type" for="${escapeHtml(inputId)}"><span class="ps-smoothing-dot" style="background:${escapeHtml(
          meta.color
        )}"></span>${escapeHtml(meta.label)}</label>
        <input id="${escapeHtml(inputId)}" class="ps-smoothing-input" type="text" inputmode="numeric" autocomplete="off" data-type="${escapeHtml(
          type
        )}" value="${escapeHtml(raw)}"${invalid ? ' aria-invalid="true"' : ""}${disabled ? " disabled" : ""}>
        <span class="ps-smoothing-peak" data-peak-for="${escapeHtml(type)}">${escapeHtml(peakText(peaks[type]))}</span>
      </div>`;
    })
    .join("");
}

const NO_MONTH_TEXT = "Aucun mois particulier : les maximums ci-dessus valent pour tous les mois.";
// Options de lecture d'une case de mois particulier : 0 y est permis (aucune
// tache, ou aucune de ce type, ce mois-la), pas dans les maximums de tous les mois.
const MONTH_CELL = { allowZero: true };
const NO_CHOICE_TEXT = "Aucun mois à ajouter";

function taskCountText(count) {
  if (!count) return "aucune tâche prévue";
  return count === 1 ? "1 tâche prévue" : `${count} tâches prévues`;
}

// Indication d'une case vide du tableau des mois : la valeur de tous les mois
// qu'elle reprend (saisie valide), sinon « — » (pas de maximum).
function cellPlaceholder(raw) {
  const parsed = parseMaxInput(raw);
  return parsed.ok && parsed.value != null ? String(parsed.value) : "—";
}

// Tableau « Mois particuliers » : une ligne par mois ajoute, une colonne Total
// puis une par type present ; chaque case vide reprend la valeur de tous les
// mois (placeholder). Bouton « Retirer » par ligne, sauf en lecture seule.
function renderMonthRows(months, types, draft, counts, disabled) {
  if (!months.length) return `<p class="ps-smoothing-empty">${escapeHtml(NO_MONTH_TEXT)}</p>`;
  const columns = [
    { key: "TOTAL", label: TOTAL_META.label, color: TOTAL_META.color, base: draft.total },
    ...types.map((type) => ({
      key: type,
      label: TYPE_META[type].label,
      color: TYPE_META[type].color,
      base: draft.byType[type] ?? "",
    })),
  ];
  const head = `<tr><th scope="col">Mois</th>${columns
    .map(
      (column) =>
        `<th scope="col"><span class="ps-smoothing-dot" style="background:${escapeHtml(column.color)}"></span>${escapeHtml(
          column.label
        )}</th>`
    )
    .join("")}${disabled ? "" : '<th scope="col"><span class="ps-smoothing-sr">Retirer</span></th>'}</tr>`;
  const body = months
    .map((month) => {
      const raw = draft.months[month];
      const label = formatMonthLabel(month);
      const cells = columns
        .map((column) => {
          const value = column.key === "TOTAL" ? raw.total : raw.byType[column.key] ?? "";
          // 0 permis dans une case de mois : aucune tache (de ce type) ce mois-la.
          const invalid = !parseMaxInput(value, MONTH_CELL).ok;
          return `<td><input class="ps-smoothing-input ps-smoothing-input--cell" type="text" inputmode="numeric" autocomplete="off" data-month="${escapeHtml(
            month
          )}" data-series="${escapeHtml(column.key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(
            cellPlaceholder(column.base)
          )}" aria-label="${escapeHtml(`${column.label}, ${label}`)}"${invalid ? ' aria-invalid="true"' : ""}${
            disabled ? " disabled" : ""
          }></td>`;
        })
        .join("");
      const remove = disabled
        ? ""
        : `<td><button type="button" class="ps-smoothing-remove" data-remove-month="${escapeHtml(
            month
          )}" aria-label="${escapeHtml(`Retirer ${label}`)}" title="Retirer ce mois">✕</button></td>`;
      return `<tr><th scope="row">${escapeHtml(label)}<span class="ps-smoothing-month-count" data-count-for="${escapeHtml(
        month
      )}">${escapeHtml(taskCountText(counts.get(month) || 0))}</span></th>${cells}${remove}</tr>`;
    })
    .join("");
  return `<table class="ps-smoothing-months-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

const NO_PLAN_TEXT = "Aucun plan particulier : le lissage place chaque plan lui-même.";
const NO_PLAN_CHOICE_TEXT = "Aucun plan à ajouter";

// Tableau « Plan particulier » (rows : buildManualPlanRows) : N°, plan (nom,
// zone et groupe dessous), type a pastille, echeance sans lissage, case date,
// note et bouton « Retirer », sauf en lecture seule. isValid(rowId, valeur)
// marque une case invalide ; minIso borne le calendrier de la case.
function renderManualPlanRows(rows, { minIso, disabled, isValid }) {
  if (!rows.length) return `<p class="ps-smoothing-empty">${escapeHtml(NO_PLAN_TEXT)}</p>`;
  const head = `<tr><th scope="col">N°</th><th scope="col">Plan</th><th scope="col">Type</th><th scope="col">Échéance sans lissage</th><th scope="col">Date manuelle</th><th scope="col"><span class="ps-smoothing-sr">Note</span></th>${
    disabled ? "" : '<th scope="col"><span class="ps-smoothing-sr">Retirer</span></th>'
  }</tr>`;
  const body = rows
    .map((row) => {
      const key = String(row.rowId);
      const number = row.id2 ? `N° ${row.id2}` : row.name || "sans N°";
      const remove = disabled
        ? ""
        : `<td><button type="button" class="ps-smoothing-remove" data-remove-plan="${escapeHtml(key)}" aria-label="${escapeHtml(
            `Retirer le plan ${number}`
          )}" title="Retirer ce plan">✕</button></td>`;
      return `<tr>
        <td class="ps-plan-search-number">${escapeHtml(row.id2)}</td>
        <td class="ps-smoothing-plan"><span class="ps-plan-search-name">${escapeHtml(row.name)}</span>${
          row.place ? `<span class="ps-plan-search-place">${escapeHtml(row.place)}</span>` : ""
        }</td>
        <td class="ps-plan-search-type"><span class="ps-plan-search-dot" style="background:${escapeHtml(
          row.typeColor
        )}"></span>${escapeHtml(row.typeLabel)}</td>
        <td class="ps-plan-search-date">${escapeHtml(formatDateFr(row.dueIso))}</td>
        <td><input class="ps-smoothing-input ps-smoothing-input--date" type="date" data-manual-plan="${escapeHtml(
          key
        )}" value="${escapeHtml(row.value)}" min="${escapeHtml(minIso)}" aria-label="${escapeHtml(
          `Date manuelle, ${number}`
        )}"${isValid(key, row.value) ? "" : ' aria-invalid="true"'}${disabled ? " disabled" : ""}></td>
        <td class="ps-smoothing-plan-note" data-note-for="${escapeHtml(key)}">${escapeHtml(row.note)}</td>
        ${remove}
      </tr>`;
    })
    .join("");
  return `<table class="ps-smoothing-plans-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// --- controleur DOM ---------------------------------------------------------------------

// rootEl = #ps-smoothing-modal. Elements internes (par id) :
//   #ps-smoothing-title, #ps-smoothing-close, #ps-smoothing-readonly,
//   #ps-smoothing-total (champ du maximum general), #ps-smoothing-types (lignes
//   par type), #ps-smoothing-field-error, #ps-smoothing-preview,
//   #ps-smoothing-feedback, #ps-smoothing-delete, #ps-smoothing-cancel,
//   #ps-smoothing-save ; et, pour le mois de depart et les mois particuliers,
//   #ps-smoothing-start (liste « Lisser a partir de »), #ps-smoothing-months
//   (tableau), #ps-smoothing-month-select et #ps-smoothing-month-add (ajout
//   d'un mois) ; pour le plan particulier, #ps-smoothing-plans-unavailable
//   (message « colonne absente »), #ps-smoothing-plans (tableau),
//   #ps-smoothing-plan-select, #ps-smoothing-plan-add et
//   #ps-smoothing-plan-browse (« Choisir dans la liste… »).
// compute(settings) -> SmoothingResult ; onSubmit / onDelete -> Promise<{ ok, error? }>.
// pickerEl = #ps-plan-pick-modal, la fenetre « Choisir les plans », creee par
// createPicker (createPlanSearchModal, injectable pour les tests) avec le
// prefixe ps-plan-pick.
//
// Contexte d'open / refresh : { title, typesPresent, tasks, todayIso, settings,
// saved, readOnly, manualDates ({ rowId: "AAAA-MM-JJ" } enregistrees),
// hasManualColumn, subtitle (« Projet · Service »), service }. refresh accepte
// tasks, todayIso et manualDates.
//
// Dates manuelles. La saisie (draft.manual, { rowId: "AAAA-MM-JJ" | "" } : une
// case videe garde sa ligne, sans date) note les plans touches pendant la
// session (ajoutes, modifies, retires) ; une relecture (refresh avec
// manualDates) ne remplace que les autres, et open remet tout a zero. Les
// dates de plans non affiches (realises, absents des taches) sont gardees
// telles quelles. readDraft().settings.manualDates porte toutes les dates non
// vides de la saisie, toujours present (meme {}) quand hasManualColumn, absent
// sinon.
//
// Balisage absent (un index.html reste en cache sans ce bloc) : fenetre inerte,
// sans exception — le controleur du lissage la cree au demarrage du widget, et
// une exception ici laisserait tout le widget blanc. Meme garde que
// bottom/chargeAssignModal.js. Un index.html en cache SANS les quatre elements
// du mois de depart et des mois particuliers, ou sans ceux du plan
// particulier, garde une fenetre qui marche : ces reglages-la n'y sont
// simplement pas modifiables (ceux enregistres sont gardes).
export function createSmoothingModal(
  rootEl,
  { compute, onSubmit, onDelete, debounceMs = 150, pickerEl = null, createPicker = createPlanSearchModal } = {}
) {
  if (typeof HTMLElement === "undefined" || !(rootEl instanceof HTMLElement)) {
    return { open() {}, refresh() {}, close() {}, isOpen: () => false, destroy() {} };
  }

  const $ =(id) => rootEl.querySelector(`#${id}`);
  const titleEl = $("ps-smoothing-title");
  const closeBtn = $("ps-smoothing-close");
  const readonlyEl = $("ps-smoothing-readonly");
  const totalEl = $("ps-smoothing-total");
  const typesEl = $("ps-smoothing-types");
  const fieldErrorEl = $("ps-smoothing-field-error");
  const previewEl = $("ps-smoothing-preview");
  const feedbackEl = $("ps-smoothing-feedback");
  const deleteBtn = $("ps-smoothing-delete");
  const cancelBtn = $("ps-smoothing-cancel");
  const saveBtn = $("ps-smoothing-save");
  const startEl = $("ps-smoothing-start");
  const monthsEl = $("ps-smoothing-months");
  const monthSelectEl = $("ps-smoothing-month-select");
  const monthAddBtn = $("ps-smoothing-month-add");
  const plansUnavailableEl = $("ps-smoothing-plans-unavailable");
  const plansEl = $("ps-smoothing-plans");
  const planSelectEl = $("ps-smoothing-plan-select");
  const planAddBtn = $("ps-smoothing-plan-add");
  const planBrowseBtn = $("ps-smoothing-plan-browse");

  let opened = false;
  let submitting = false;
  let timer = null;
  // Contexte courant (open / refresh) et saisie en cours (TEXTE brut des champs :
  // la saisie survit a un refresh du contexte). draft.start : mois de depart
  // choisi ("" = mois en cours) ; draft.months : mois particuliers ajoutes,
  // { "AAAA-MM": { total, byType } } ; draft.manual : dates manuelles,
  // { rowId: "AAAA-MM-JJ" | "" }.
  let context = {
    title: "",
    typesPresent: [],
    tasks: [],
    todayIso: "",
    settings: null,
    saved: false,
    readOnly: false,
    manualDates: {},
    hasManualColumn: false,
    subtitle: "",
    service: "",
  };
  let draft = { total: "", byType: {}, start: "", months: {}, manual: {} };
  // rowId (texte) des plans ajoutes, modifies ou retires pendant la session.
  let touched = new Set();
  // Dernier resultat de l'apercu (SmoothingResult ou null) : date lissee d'un
  // plan ajoute, notes des lignes, plans de la fenetre « Choisir les plans ».
  let lastResult = null;

  // Fenetre « Choisir les plans », creee AVANT l'ecouteur d'Echap de celle-ci :
  // le sien passe donc d'abord (voir handleKeyDown). Inerte si createPicker
  // ne rend rien.
  const picker = (typeof createPicker === "function"
    ? createPicker(pickerEl, { idPrefix: "ps-plan-pick", onManualDateChange: handlePickerChange })
    : null) || { open() {}, update() {}, close() {}, isOpen: () => false, destroy() {} };

  const presentTypes = () => TYPE_ORDER.filter((type) => (context.typesPresent || []).includes(type));
  // Mois de depart de la saisie (AAAA-MM), comme le lissage le calcule.
  const startKeyNow = () => smoothingStartMonth({ startMonth: draft.start || null }, context.todayIso);
  // Premiere date manuelle qu'on peut saisir (§5.3).
  const minManualIso = () => firstAllowedManualIso(startKeyNow(), context.todayIso);

  // Date manuelle acceptee : vide (pas de date), ou date reelle a partir de la
  // premiere date permise — ou egale a la date enregistree (le temps a passe).
  function manualValueOk(key, value, minIso = minManualIso()) {
    if (!value) return true;
    return isIsoDate(value) && (value >= minIso || value === context.manualDates?.[key]);
  }

  // rowId des plans affiches dans le tableau (non realises, dans la saisie).
  function shownManualKeys() {
    return (context.tasks || [])
      .filter((task) => isManualCandidate(task) && hasKey(draft.manual, String(task.rowId)))
      .map((task) => String(task.rowId));
  }

  // Saisie des dates -> { manualDates, error } ; manualDates est null sans
  // colonne. Seules les dates affichees sont verifiees.
  function readManualDraft() {
    if (!context.hasManualColumn) return { manualDates: null, error: null };
    const manualDates = {};
    Object.keys(draft.manual).forEach((key) => {
      if (draft.manual[key]) manualDates[key] = draft.manual[key];
    });
    const minIso = minManualIso();
    const invalid = shownManualKeys().some((key) => !manualValueOk(key, draft.manual[key], minIso));
    return { manualDates, error: invalid ? `Choisissez une date à partir du ${formatDateFr(minIso)}.` : null };
  }

  // Dates valides de la saisie, pour la fenetre « Choisir les plans ».
  function validManualDates() {
    return Object.fromEntries(Object.entries(draft.manual).filter(([, value]) => isIsoDate(value)));
  }

  // Un groupe de champs { total, byType } -> { maxima, error } ; les types sans
  // ligne gardent leur valeur enregistree (savedByType). `options` : MONTH_CELL
  // pour un mois particulier (0 permis).
  function readMaxima(raw, savedByType, shown, options = undefined) {
    let error = null;
    const maxima = { maxTotal: null, maxByType: {} };
    Object.entries(savedByType || {}).forEach(([type, value]) => {
      if (!shown.includes(type)) maxima.maxByType[type] = value;
    });
    const total = parseMaxInput(raw.total, options);
    if (!total.ok) error = total.message;
    else maxima.maxTotal = total.value;
    shown.forEach((type) => {
      const parsed = parseMaxInput(raw.byType[type] ?? "", options);
      if (!parsed.ok) error = error || parsed.message;
      else if (parsed.value != null) maxima.maxByType[type] = parsed.value;
    });
    return { maxima, error };
  }

  // Saisie -> { settings, firstError } ; settings ignore les champs invalides.
  // startMonth n'y figure que s'il est choisi, maxByMonth que si un mois porte
  // au moins un maximum (un mois ajoute mais laisse vide n'est pas enregistre),
  // manualDates des que la colonne existe (voir readManualDraft).
  function readDraft() {
    // Maximums enregistres pour un type sans tache (donc sans ligne ni
    // colonne) : conserves.
    const shown = presentTypes();
    const base = readMaxima(draft, context.settings?.maxByType, shown);
    let firstError = base.error;
    const settings = base.maxima;
    if (draft.start) settings.startMonth = draft.start;
    const maxByMonth = {};
    Object.keys(draft.months)
      .sort()
      .forEach((month) => {
        const own = readMaxima(draft.months[month], context.settings?.maxByMonth?.[month]?.maxByType, shown, MONTH_CELL);
        firstError = firstError || own.error;
        if (own.maxima.maxTotal != null || Object.keys(own.maxima.maxByType).length) maxByMonth[month] = own.maxima;
      });
    if (Object.keys(maxByMonth).length) settings.maxByMonth = maxByMonth;
    const manual = readManualDraft();
    if (manual.manualDates) settings.manualDates = manual.manualDates;
    firstError = firstError || manual.error;
    return { settings, firstError };
  }

  function showFeedback(text) {
    if (!feedbackEl) return;
    feedbackEl.textContent = text || "";
    feedbackEl.hidden = !text;
  }

  function syncButtons() {
    const { firstError } = readDraft();
    const readOnly = Boolean(context.readOnly);
    if (fieldErrorEl) {
      fieldErrorEl.textContent = firstError || "";
      fieldErrorEl.hidden = !firstError;
    }
    if (saveBtn) {
      saveBtn.hidden = readOnly;
      saveBtn.disabled = Boolean(firstError) || submitting;
    }
    if (deleteBtn) {
      deleteBtn.hidden = readOnly || !context.saved;
      deleteBtn.disabled = submitting;
    }
  }

  function renderPreviewNow() {
    const { settings, firstError } = readDraft();
    // Saisie invalide : on garde le dernier apercu valide plutot que d'afficher
    // un calcul sur des maximums partiels.
    if (previewEl && !firstError) {
      let result = null;
      try {
        result = typeof compute === "function" ? compute(settings) : null;
      } catch (error) {
        console.warn("Lissage : calcul de l'aperçu impossible.", error);
      }
      lastResult = result;
      previewEl.innerHTML = renderPreview(result, startKeyNow());
    }
    // Les notes des plans et la fenetre « Choisir les plans » (« Échéance
    // lissée ») suivent l'apercu.
    renderPlans();
    if (picker.isOpen()) picker.update(pickerModel());
  }

  function schedulePreview() {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (opened) renderPreviewNow();
    }, debounceMs);
  }

  function cancelPreviewTimer() {
    if (timer != null) clearTimeout(timer);
    timer = null;
  }

  // Types et mode affiches par le dernier rendu complet des lignes.
  let renderedKey = null;

  function renderTypes() {
    if (!typesEl) return;
    const types = presentTypes();
    const peaks = computeTypePeaks(context.tasks, context.todayIso);
    const key = `${types.join(",")}|${context.readOnly ? "ro" : "rw"}`;
    // Memes lignes qu'avant (cas d'un refresh) : seuls les « pic actuel » sont
    // mis a jour, pour ne pas detruire le champ en cours de frappe (focus, curseur).
    if (key === renderedKey && typeof typesEl.querySelectorAll === "function") {
      Array.from(typesEl.querySelectorAll(".ps-smoothing-peak")).forEach((span) => {
        const type = span.dataset?.peakFor;
        if (type) span.textContent = peakText(peaks[type]);
      });
      return;
    }
    typesEl.innerHTML = renderTypeRows(types, draft, peaks, Boolean(context.readOnly));
    renderedKey = key;
  }

  // Liste « Lisser a partir de ».
  function renderStart() {
    if (!startEl) return;
    startEl.innerHTML = buildStartOptions(context.tasks, context.todayIso, draft.start)
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}"${option.value === draft.start ? " selected" : ""}>${escapeHtml(
            option.label
          )}</option>`
      )
      .join("");
    startEl.value = draft.start;
    startEl.disabled = Boolean(context.readOnly);
  }

  // Mois, types et mode affiches par le dernier rendu complet du tableau des
  // mois particuliers.
  let renderedMonthsKey = null;

  // Tableau des mois particuliers. Memes mois, types et mode qu'au dernier
  // rendu (refresh, saisie d'un maximum de tous les mois) : seules les
  // indications des cases vides et les comptes de taches sont mis a jour, pour
  // ne pas detruire le champ en cours de frappe.
  function renderMonths() {
    if (!monthsEl) return;
    const months = Object.keys(draft.months).sort();
    const types = presentTypes();
    const key = `${months.join(",")}|${types.join(",")}|${context.readOnly ? "ro" : "rw"}`;
    if (key === renderedMonthsKey && typeof monthsEl.querySelectorAll === "function") {
      syncMonthCells();
      return;
    }
    monthsEl.innerHTML = renderMonthRows(months, types, draft, countByMonth(context.tasks), Boolean(context.readOnly));
    renderedMonthsKey = key;
  }

  function syncMonthCells() {
    if (!monthsEl || typeof monthsEl.querySelectorAll !== "function") return;
    Array.from(monthsEl.querySelectorAll("input[data-series]")).forEach((input) => {
      const series = input.dataset?.series;
      input.placeholder = cellPlaceholder(series === "TOTAL" ? draft.total : draft.byType[series] ?? "");
    });
    const counts = countByMonth(context.tasks);
    Array.from(monthsEl.querySelectorAll("[data-count-for]")).forEach((span) => {
      span.textContent = taskCountText(counts.get(span.dataset?.countFor) || 0);
    });
  }

  // Liste des mois a ajouter : du mois de depart a la derniere echeance, sans
  // les mois deja dans le tableau. Le mois choisi est garde s'il reste propose ;
  // sinon la liste s'ouvre sur le premier mois a venir (le plus souvent
  // regle), a defaut sur le premier propose.
  function renderMonthChoices() {
    if (!monthSelectEl) return;
    const previous = String(monthSelectEl.value ?? "");
    const choices = buildMonthChoices(context.tasks, startKeyNow(), Object.keys(draft.months));
    monthSelectEl.innerHTML = choices.length
      ? choices.map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("")
      : `<option value="">${escapeHtml(NO_CHOICE_TEXT)}</option>`;
    const current = monthKeyOf(context.todayIso);
    const fallback = choices.find((choice) => choice.value >= current) || choices[0];
    monthSelectEl.value = choices.some((choice) => choice.value === previous) ? previous : fallback?.value ?? "";
    monthSelectEl.disabled = Boolean(context.readOnly) || !choices.length;
    if (monthAddBtn) {
      monthAddBtn.hidden = Boolean(context.readOnly);
      monthAddBtn.disabled = Boolean(context.readOnly) || !choices.length;
    }
  }

  // Plans et mode affiches par le dernier rendu complet du tableau « Plan
  // particulier ».
  let renderedPlansKey = null;

  // Tableau « Plan particulier ». Memes plans et meme mode qu'au dernier rendu
  // (apercu recalcule, refresh, frappe dans une case, date posee par la
  // fenetre par-dessus) : les cases sont mises a jour en place, sans etre
  // recreees, pour ne pas detruire la case en cours de frappe (voir
  // syncPlanCells ; blurred : case qui perd le focus). Sans colonne : tableau
  // vide.
  function renderPlans(blurred = null) {
    if (!plansEl) return;
    if (!context.hasManualColumn) {
      plansEl.innerHTML = "";
      renderedPlansKey = null;
      return;
    }
    const rows = buildManualPlanRows({ tasks: context.tasks, draftManual: draft.manual, result: lastResult });
    const readOnly = Boolean(context.readOnly);
    const key = `${rows.map((row) => String(row.rowId)).sort().join(",")}|${readOnly ? "ro" : "rw"}`;
    if (key === renderedPlansKey && typeof plansEl.querySelectorAll === "function") {
      syncPlanCells(rows, blurred);
      return;
    }
    const minIso = minManualIso();
    plansEl.innerHTML = renderManualPlanRows(rows, {
      minIso,
      disabled: readOnly,
      isValid: (rowKey, value) => manualValueOk(rowKey, value, minIso),
    });
    renderedPlansKey = key;
  }

  function markManualValidity(input, key, value, minIso = minManualIso()) {
    if (manualValueOk(key, value, minIso)) input.removeAttribute?.("aria-invalid");
    else input.setAttribute?.("aria-invalid", "true");
  }

  // Mise a jour en place : notes, puis, pour chaque case, sa date (la saisie a
  // pu changer par la fenetre « Choisir les plans » ou par une relecture), sa
  // borne et sa marque d'erreur (le mois de depart a pu changer). La case qui
  // a le focus garde ce qui y est tape (une date en cours de frappe vaut "") ;
  // elle reprend la saisie quand elle perd le focus (blurred, handlePlansFocusOut).
  function syncPlanCells(rows, blurred = null) {
    const notes = new Map(rows.map((row) => [String(row.rowId), row.note]));
    Array.from(plansEl.querySelectorAll("[data-note-for]")).forEach((cell) => {
      const key = cell.dataset?.noteFor;
      if (notes.has(key)) cell.textContent = notes.get(key);
    });
    const minIso = minManualIso();
    const focused = typeof document !== "undefined" ? document.activeElement : null;
    Array.from(plansEl.querySelectorAll("input[data-manual-plan]")).forEach((input) => {
      const key = input.dataset?.manualPlan;
      if (!key) return;
      const value = String(draft.manual[key] ?? "");
      if ((input !== focused || input === blurred) && input.value !== value) input.value = value;
      input.min = minIso;
      markManualValidity(input, key, value, minIso);
    });
  }

  // Ligne d'ajout : liste des plans sans date manuelle (le choix courant est
  // garde s'il reste propose), « Ajouter ce plan », « Choisir dans la liste… ».
  // Lecture seule : seule la fenetre « Choisir les plans » reste, en
  // consultation. Colonne absente : message, liste et boutons desactives.
  function renderPlanChoices() {
    const readOnly = Boolean(context.readOnly);
    const hasColumn = Boolean(context.hasManualColumn);
    if (plansUnavailableEl) plansUnavailableEl.hidden = hasColumn;
    const choices = hasColumn ? buildPlanChoices(context.tasks, draft.manual) : [];
    if (planSelectEl) {
      const previous = String(planSelectEl.value ?? "");
      planSelectEl.innerHTML = choices.length
        ? choices.map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("")
        : `<option value="">${escapeHtml(NO_PLAN_CHOICE_TEXT)}</option>`;
      planSelectEl.value = choices.some((choice) => choice.value === previous) ? previous : choices[0]?.value ?? "";
      planSelectEl.hidden = readOnly;
      planSelectEl.disabled = readOnly || !choices.length;
    }
    if (planAddBtn) {
      planAddBtn.hidden = readOnly;
      planAddBtn.disabled = readOnly || !choices.length;
    }
    if (planBrowseBtn) {
      planBrowseBtn.hidden = false;
      planBrowseBtn.disabled = !hasColumn;
    }
  }

  // Modele de la fenetre « Choisir les plans » : les plans du dernier apercu
  // (SmoothedTask) si le lissage est actif, sinon ceux du contexte.
  function pickerModel() {
    const active = Boolean(lastResult?.active);
    const tasks = active && Array.isArray(lastResult.tasks) ? lastResult.tasks : context.tasks;
    return {
      subtitle: context.subtitle || "",
      service: context.service || "",
      active,
      entries: buildPlanSearchEntries({ tasks, active }),
      manual: { dates: validManualDates(), minIso: minManualIso(), readOnly: Boolean(context.readOnly) },
    };
  }

  function renderStatic() {
    if (titleEl) titleEl.textContent = context.title || "Lissage des tâches";
    if (readonlyEl) {
      readonlyEl.textContent = context.readOnly ? READ_ONLY_TEXT : "";
      readonlyEl.hidden = !context.readOnly;
    }
    if (totalEl) {
      totalEl.value = draft.total;
      totalEl.disabled = Boolean(context.readOnly);
      if (parseMaxInput(draft.total).ok) totalEl.removeAttribute("aria-invalid");
      else totalEl.setAttribute("aria-invalid", "true");
    }
  }

  // { maxTotal, maxByType } enregistres -> champs texte { total, byType }.
  function draftMaxima(maxima) {
    const raw = { total: maxima?.maxTotal != null ? String(maxima.maxTotal) : "", byType: {} };
    Object.entries(maxima?.maxByType || {}).forEach(([type, value]) => {
      raw.byType[type] = String(value);
    });
    return raw;
  }

  function open(nextContext) {
    cancelPreviewTimer();
    context = { ...context, ...nextContext };
    const settings = context.settings || {};
    // Un mois de depart enregistre qui n'est plus passe (le calendrier l'a
    // rattrape) revient au mois en cours.
    const start = settings.startMonth;
    draft = {
      ...draftMaxima(settings),
      start: isMonthKey(start) && start < monthKeyOf(context.todayIso) ? start : "",
      months: {},
    };
    Object.entries(settings.maxByMonth || {}).forEach(([month, maxima]) => {
      draft.months[month] = draftMaxima(maxima);
    });
    draft.manual = cleanManualDates(context.manualDates);
    touched = new Set();
    lastResult = null;
    // Une saisie remise a zero : la fenetre par-dessus montrerait l'ancienne.
    picker.close();
    submitting = false;
    showFeedback("");
    renderStatic();
    renderStart();
    renderedKey = null; // ouverture : les lignes sont toujours reconstruites
    renderedMonthsKey = null;
    renderedPlansKey = null;
    renderTypes();
    renderMonths();
    renderMonthChoices();
    renderPlans();
    renderPlanChoices();
    syncButtons();
    renderPreviewNow();
    rootEl.style.display = "flex";
    opened = true;
  }

  // { rowId: iso } -> copie aux cles texte, sans valeur vide.
  function cleanManualDates(dates) {
    const clean = {};
    Object.entries(dates || {}).forEach(([key, iso]) => {
      if (iso) clean[String(key)] = String(iso);
    });
    return clean;
  }

  // Nouvelles dates enregistrees (relecture) : les plans non touches les
  // prennent (une date disparue retire la ligne), les plans touches gardent la
  // saisie ; elles deviennent l'etat enregistre de reference.
  function mergeManualDates(dates) {
    const incoming = cleanManualDates(dates);
    new Set([...Object.keys(draft.manual), ...Object.keys(incoming)]).forEach((key) => {
      if (touched.has(key)) return;
      if (hasKey(incoming, key)) draft.manual[key] = incoming[key];
      else delete draft.manual[key];
    });
    context.manualDates = incoming;
  }

  // Le projet a ete relu (un collegue a modifie le planning) : on recalcule les
  // pics et l'apercu sur les nouvelles taches, en gardant la saisie en cours.
  function refresh({ tasks, todayIso, manualDates } = {}) {
    if (!opened) return;
    if (tasks) context.tasks = tasks;
    if (todayIso) context.todayIso = todayIso;
    if (manualDates) mergeManualDates(manualDates);
    cancelPreviewTimer();
    renderStart();
    renderTypes();
    renderMonths();
    renderMonthChoices();
    renderPlans();
    renderPlanChoices();
    syncButtons();
    renderPreviewNow();
  }

  function close() {
    cancelPreviewTimer();
    picker.close();
    rootEl.style.display = "none";
    opened = false;
  }

  function isOpen() {
    return opened;
  }

  // Saisie dans un champ de maximum : general, ligne d'un type, ou case du
  // tableau des mois particuliers (data-month + data-series).
  function handleInput(event) {
    if (context.readOnly) return;
    const target = event.target;
    if (!target) return;
    const value = String(target.value ?? "");
    const month = target.dataset?.month;
    const type = target.dataset?.type;
    if (month) {
      const row = draft.months[month];
      const series = target.dataset?.series;
      if (!row || !series) return;
      if (series === "TOTAL") row.total = value;
      else row.byType[series] = value;
    } else if (type) draft.byType[type] = value;
    else if (target === totalEl) draft.total = value;
    else return;
    const parsed = parseMaxInput(value, month ? MONTH_CELL : undefined);
    if (parsed.ok) target.removeAttribute?.("aria-invalid");
    else target.setAttribute?.("aria-invalid", "true");
    // Un maximum de tous les mois change : les cases vides du tableau
    // l'indiquent aussitot.
    if (!month) syncMonthCells();
    showFeedback("");
    syncButtons();
    schedulePreview();
  }

  // Le mois de depart change : mois proposes, premiere date manuelle permise et
  // apercu suivent (les pics, eux, ne comptent que les taches a venir).
  function handleStartChange() {
    if (context.readOnly || !startEl) return;
    draft.start = String(startEl.value ?? "");
    renderMonthChoices();
    renderPlans();
    showFeedback("");
    syncButtons();
    schedulePreview();
  }

  // Ajoute au tableau le mois choisi dans la liste, et place le curseur dans
  // sa premiere case.
  function handleAddMonth() {
    if (context.readOnly || !monthSelectEl) return;
    const month = String(monthSelectEl.value ?? "");
    if (!isMonthKey(month) || draft.months[month]) return;
    draft.months[month] = { total: "", byType: {} };
    renderMonths();
    renderMonthChoices();
    syncButtons();
    schedulePreview();
    const firstCell = typeof monthsEl?.querySelector === "function"
      ? monthsEl.querySelector(`input[data-month="${month}"]`)
      : null;
    firstCell?.focus?.();
  }

  // Bouton « Retirer » d'une ligne du tableau (evenement delegue).
  function handleMonthsClick(event) {
    if (context.readOnly) return;
    const target = event?.target;
    const button = typeof target?.closest === "function" ? target.closest("[data-remove-month]") : target;
    const month = button?.dataset?.removeMonth;
    if (!month || !draft.months[month]) return;
    delete draft.months[month];
    renderMonths();
    renderMonthChoices();
    showFeedback("");
    syncButtons();
    schedulePreview();
  }

  // --- plan particulier ---

  const canEditManual = () => !context.readOnly && Boolean(context.hasManualColumn);

  // La saisie des dates a change (ajout, retrait, fenetre par-dessus) : lignes,
  // choix, boutons et apercu suivent.
  function afterManualChange() {
    renderPlans();
    renderPlanChoices();
    showFeedback("");
    syncButtons();
    schedulePreview();
  }

  // Frappe dans une case « Date manuelle » (evenement delegue). Le tableau
  // n'est pas reconstruit : la case garde le focus. Vider la case retire la
  // date, pas la ligne.
  function handlePlansInput(event) {
    if (!canEditManual()) return;
    const target = event?.target;
    const key = target?.dataset?.manualPlan;
    if (!key || !hasKey(draft.manual, key)) return;
    const value = String(target.value ?? "");
    draft.manual[key] = value;
    touched.add(key);
    markManualValidity(target, key, value);
    showFeedback("");
    syncButtons();
    schedulePreview();
  }

  // Le focus quitte une case date : si la saisie a change pendant qu'elle
  // l'avait (relecture), elle la reprend. Une date en cours de frappe vaut deja
  // "" dans la saisie : rien n'est reecrit. (Pendant focusout, le navigateur
  // peut encore designer cette case comme activeElement : elle est passee.)
  function handlePlansFocusOut(event) {
    const target = event?.target;
    if (target?.dataset?.manualPlan === undefined) return;
    renderPlans(target);
  }

  // Bouton « Retirer » d'une ligne du tableau (evenement delegue).
  function handlePlansClick(event) {
    if (!canEditManual()) return;
    const target = event?.target;
    const button = typeof target?.closest === "function" ? target.closest("[data-remove-plan]") : target;
    const key = button?.dataset?.removePlan;
    if (!key || !hasKey(draft.manual, key)) return;
    delete draft.manual[key];
    touched.add(key);
    afterManualChange();
  }

  // Ajoute le plan choisi avec sa date lissee du dernier apercu (a defaut son
  // echeance), jamais avant la premiere date permise (un plan en retard
  // arriverait sinon deja en erreur), et place le curseur dans sa case.
  function handleAddPlan() {
    if (!canEditManual() || !planSelectEl) return;
    const key = String(planSelectEl.value ?? "");
    const task = (context.tasks || []).find((item) => isManualCandidate(item) && String(item.rowId) === key);
    if (!task || hasKey(draft.manual, key)) return;
    const smoothed = (Array.isArray(lastResult?.tasks) ? lastResult.tasks : []).find(
      (item) => item?.rowId != null && String(item.rowId) === key
    );
    const iso = String(smoothed?.smoothedIso || task.dueIso || "");
    const minIso = minManualIso();
    draft.manual[key] = !iso || iso < minIso ? minIso : iso;
    touched.add(key);
    afterManualChange();
    const input = typeof plansEl?.querySelector === "function"
      ? plansEl.querySelector(`input[data-manual-plan="${key}"]`)
      : null;
    input?.focus?.();
  }

  // « Choisir dans la liste… » : la fenetre par-dessus, en consultation en
  // lecture seule.
  function handleBrowse() {
    if (!context.hasManualColumn) return;
    picker.open(pickerModel());
  }

  // Case date de la fenetre « Choisir les plans » : une date la pose (et ajoute
  // la ligne). "" (✕, ou date en cours de frappe) vide la case sans retirer la
  // ligne ; pour un plan sans ligne, il ne change rien.
  function handlePickerChange(rowId, value) {
    if (!opened || !canEditManual()) return;
    const key = String(rowId);
    const iso = String(value ?? "");
    if (iso || hasKey(draft.manual, key)) {
      draft.manual[key] = iso;
      touched.add(key);
    }
    afterManualChange();
  }

  // Lance une ecriture deleguee au controleur ; ferme sur succes, sinon affiche
  // l'erreur et garde la saisie.
  async function runAction(action, fallbackError) {
    if (submitting || typeof action !== "function") return;
    submitting = true;
    showFeedback("");
    syncButtons();
    let outcome;
    try {
      outcome = await action();
    } catch (error) {
      outcome = { ok: false, error: error?.message || fallbackError };
    }
    submitting = false;
    if (outcome && outcome.ok) {
      close();
      return;
    }
    showFeedback((outcome && outcome.error) || fallbackError);
    syncButtons();
  }

  function handleSave() {
    if (context.readOnly) return;
    const { settings, firstError } = readDraft();
    if (firstError) return;
    return runAction(() => onSubmit(settings), "L'enregistrement a échoué.");
  }

  function handleDelete() {
    if (context.readOnly || !context.saved) return;
    const confirmed = typeof window !== "undefined" && window.confirm
      ? window.confirm("Supprimer le lissage de ce service (maximums et dates manuelles) ?")
      : true;
    if (!confirmed) return;
    return runAction(() => onDelete(), "La suppression a échoué.");
  }

  function handleClose() {
    if (!submitting) close();
  }

  // Echap avec « Choisir les plans » ouverte : seule celle-ci se ferme. Son
  // ecouteur passe avant celui-ci (il ferme et appelle preventDefault) ou
  // apres (elle est encore ouverte) : les deux cas sont couverts.
  function handleKeyDown(event) {
    if (event.key !== "Escape" || !opened) return;
    if (event.defaultPrevented || picker.isOpen()) return;
    handleClose();
  }

  function handleBackdropClick(event) {
    if (event.target === rootEl) handleClose();
  }

  totalEl?.addEventListener("input", handleInput);
  typesEl?.addEventListener("input", handleInput);
  monthsEl?.addEventListener("input", handleInput);
  monthsEl?.addEventListener("click", handleMonthsClick);
  startEl?.addEventListener("change", handleStartChange);
  monthAddBtn?.addEventListener("click", handleAddMonth);
  plansEl?.addEventListener("input", handlePlansInput);
  plansEl?.addEventListener("click", handlePlansClick);
  plansEl?.addEventListener("focusout", handlePlansFocusOut);
  planAddBtn?.addEventListener("click", handleAddPlan);
  planBrowseBtn?.addEventListener("click", handleBrowse);
  closeBtn?.addEventListener("click", handleClose);
  cancelBtn?.addEventListener("click", handleClose);
  saveBtn?.addEventListener("click", handleSave);
  deleteBtn?.addEventListener("click", handleDelete);
  rootEl.addEventListener("click", handleBackdropClick);
  document.addEventListener("keydown", handleKeyDown);

  function destroy() {
    close();
    totalEl?.removeEventListener("input", handleInput);
    typesEl?.removeEventListener("input", handleInput);
    monthsEl?.removeEventListener("input", handleInput);
    monthsEl?.removeEventListener("click", handleMonthsClick);
    startEl?.removeEventListener("change", handleStartChange);
    monthAddBtn?.removeEventListener("click", handleAddMonth);
    plansEl?.removeEventListener("input", handlePlansInput);
    plansEl?.removeEventListener("click", handlePlansClick);
    plansEl?.removeEventListener("focusout", handlePlansFocusOut);
    planAddBtn?.removeEventListener("click", handleAddPlan);
    planBrowseBtn?.removeEventListener("click", handleBrowse);
    closeBtn?.removeEventListener("click", handleClose);
    cancelBtn?.removeEventListener("click", handleClose);
    saveBtn?.removeEventListener("click", handleSave);
    deleteBtn?.removeEventListener("click", handleDelete);
    rootEl.removeEventListener("click", handleBackdropClick);
    document.removeEventListener("keydown", handleKeyDown);
    picker.destroy();
  }

  return { open, refresh, close, isOpen, destroy };
}
