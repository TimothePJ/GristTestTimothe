// Fenêtre « Lien de la tâche » de la vue Synthese, ouverte par le clic droit sur une tâche : on y
// choisit la tâche à suivre (les tâches de sa zone, rangées par étage et cycle comme le tableau,
// avec leur numéro de ligne), le type de lien et le décalage ; l'aperçu dit les nouvelles dates
// avant de valider. Les choix et l'aperçu viennent du contrôleur (voir linkChoices et previewLink) ;
// la fenêtre ne fait que les montrer et rendre le lien choisi.
import { MAX_DURATION_DAYS } from "../services/syntheseTaskModel.js";

const LINK_TYPES = Object.freeze([
  { type: "FD", label: "Fin → début" },
  { type: "DD", label: "Début → début" },
  { type: "FF", label: "Fin → fin" },
]);

// Valeurs du formulaire → lien : { ok, link } (link null : plus de lien), ou { ok: false, error }.
export function readLinkForm({ predId = "", type = "FD", lag = "" } = {}) {
  const id = Number(predId);
  if (!String(predId).trim() || !Number.isInteger(id) || id <= 0) return { ok: true, link: null };
  const text = String(lag ?? "").trim();
  const days = text ? Number(text) : 0;
  if (!Number.isInteger(days)) return { ok: false, error: "Le décalage doit être un nombre entier de jours ouvrés." };
  if (Math.abs(days) > MAX_DURATION_DAYS) return { ok: false, error: `Le décalage est limité à ${MAX_DURATION_DAYS} jours ouvrés.` };
  const known = LINK_TYPES.some((item) => item.type === type);
  return { ok: true, link: { predId: id, type: known ? type : "FD", lag: days } };
}

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// La fenêtre, créée une fois (dans `doc.body`). `open(model)` la montre pour une tâche — model :
// { taskName, current, rows, preview(link) } — et `onSubmit(link)` reçoit le lien validé.
export function createLinkDialog({ doc = document, onSubmit = () => {} } = {}) {
  const dialog = createElement(doc, "dialog", "synthese-link-dialog");
  dialog.setAttribute("aria-labelledby", "syntheseLinkDialogTitle");
  const form = createElement(doc, "form", "synthese-link-dialog__form");
  form.method = "dialog";
  form.noValidate = true;

  const header = createElement(doc, "div", "synthese-link-dialog__header");
  const title = createElement(doc, "h3", "");
  title.id = "syntheseLinkDialogTitle";
  const closeButton = createElement(doc, "button", "synthese-link-dialog__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Fermer");
  header.append(title, closeButton);

  const search = createElement(doc, "input", "synthese-link-dialog__search");
  search.type = "search";
  search.placeholder = "Rechercher une tâche (nom ou n° de ligne)";
  search.setAttribute("aria-label", "Rechercher une tâche");

  const listLabel = createElement(doc, "p", "synthese-link-dialog__label", "Suit la tâche :");
  const list = createElement(doc, "div", "synthese-link-dialog__list");
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", "Tâche à suivre");

  const typeGroup = createElement(doc, "fieldset", "synthese-link-dialog__types");
  typeGroup.appendChild(createElement(doc, "legend", "", "Type"));
  const typeInputs = LINK_TYPES.map(({ type, label }) => {
    const option = createElement(doc, "label", "synthese-link-dialog__type");
    const input = createElement(doc, "input", "");
    input.type = "radio";
    input.name = "linkType";
    input.value = type;
    option.append(input, doc.createTextNode(` ${label}`));
    typeGroup.appendChild(option);
    return input;
  });

  const lagField = createElement(doc, "label", "synthese-link-dialog__lag", "Décalage ");
  const lagInput = createElement(doc, "input", "");
  lagInput.type = "number";
  lagInput.step = "1";
  lagInput.min = String(-MAX_DURATION_DAYS);
  lagInput.max = String(MAX_DURATION_DAYS);
  lagField.append(lagInput, doc.createTextNode(" jours ouvrés"));

  const preview = createElement(doc, "p", "synthese-link-dialog__preview");
  preview.setAttribute("role", "status");
  const error = createElement(doc, "p", "synthese-link-dialog__error");
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = createElement(doc, "div", "synthese-link-dialog__actions");
  const cancelButton = createElement(doc, "button", "synthese-link-dialog__cancel", "Annuler");
  cancelButton.type = "button";
  const submitButton = createElement(doc, "button", "synthese-link-dialog__submit", "Valider");
  submitButton.type = "submit";
  actions.append(cancelButton, submitButton);

  form.append(header, search, listLabel, list, typeGroup, lagField, preview, error, actions);
  dialog.appendChild(form);
  doc.body.appendChild(dialog);

  let model = null;

  function values() {
    const chosen = list.querySelector('input[name="linkTask"]:checked');
    const type = typeInputs.find((input) => input.checked)?.value || "FD";
    // Un texte illisible dans le champ nombre (« - », « 1e ») s'y lit vide : il doit être refusé, pas
    // pris pour 0.
    return { predId: chosen ? chosen.value : "", type, lag: lagInput.validity?.badInput ? "?" : lagInput.value };
  }

  // Aperçu et état du formulaire après chaque changement : type et décalage n'ont de sens qu'avec
  // une tâche à suivre ; un décalage illisible bloque la validation.
  function refresh() {
    const current = values();
    const noTask = !current.predId;
    typeInputs.forEach((input) => { input.disabled = noTask; });
    lagInput.disabled = noTask;
    const read = readLinkForm(current);
    error.textContent = read.ok ? "" : read.error;
    error.hidden = read.ok;
    submitButton.disabled = !read.ok;
    preview.textContent = read.ok && model ? model.preview(read.link) : "";
  }

  function option({ value, label, number = "", dates = "", note = "", level = 0, disabled = false, checked = false }) {
    const row = createElement(doc, "label", "synthese-link-dialog__option");
    row.style.setProperty("--sld-level", String(level));
    if (disabled) row.classList.add("is-disabled");
    const input = createElement(doc, "input", "");
    input.type = "radio";
    input.name = "linkTask";
    input.value = value;
    input.disabled = disabled;
    input.checked = checked;
    row.append(
      input,
      createElement(doc, "span", "synthese-link-dialog__number", number),
      createElement(doc, "span", "synthese-link-dialog__name", label),
      createElement(doc, "span", "synthese-link-dialog__dates", note ? `${dates} · ${note}` : dates),
    );
    row.dataset.search = `${number} ${label}`.toLowerCase();
    return row;
  }

  function renderList() {
    const rows = model?.rows || [];
    const current = model?.current || null;
    // Lien actuel vers une tâche sans ligne (disparue) : « Aucune » est cochée, comme l'aperçu le dit.
    const elements = [option({ value: "", label: "Aucune (sans lien)", checked: !current || !rows.some((row) => row.selected) })];
    rows.forEach((row) => {
      if (row.kind === "header") {
        const head = createElement(doc, "div", "synthese-link-dialog__group", row.label);
        head.style.setProperty("--sld-level", String(row.level));
        elements.push(head);
        return;
      }
      elements.push(option({
        value: String(row.taskId),
        label: row.name,
        number: row.lineNumber == null ? "" : String(row.lineNumber),
        dates: row.dates,
        note: row.note,
        level: row.level + 1,
        disabled: row.disabled,
        checked: row.selected,
      }));
    });
    list.replaceChildren(...elements);
  }

  // Recherche : les tâches dont le nom ou le numéro contient le texte ; les en-têtes ne se montrent
  // que sans recherche.
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    list.querySelectorAll(".synthese-link-dialog__option").forEach((row) => {
      row.hidden = Boolean(query) && !row.dataset.search.includes(query);
    });
    list.querySelectorAll(".synthese-link-dialog__group").forEach((head) => { head.hidden = Boolean(query); });
  });

  // Entrée dans la recherche ne valide pas la fenêtre : elle choisit la première tâche trouvée.
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = [...list.querySelectorAll('input[name="linkTask"]')]
      .find((input) => input.value && !input.disabled && !input.closest(".synthese-link-dialog__option").hidden);
    if (!first) return;
    first.checked = true;
    first.focus();
    refresh();
  });

  form.addEventListener("change", refresh);
  lagInput.addEventListener("input", refresh);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const read = readLinkForm(values());
    if (!read.ok) {
      refresh();
      return;
    }
    close();
    void onSubmit(read.link);
  });
  cancelButton.addEventListener("click", () => close());
  closeButton.addEventListener("click", () => close());
  // Échap : la fenêtre se ferme sans rien changer.
  dialog.addEventListener("cancel", () => { model = null; });

  function close() {
    model = null;
    if (dialog.open) dialog.close();
  }

  function open(next) {
    model = next;
    title.textContent = `Lien de « ${next.taskName} »`;
    search.value = "";
    renderList();
    const current = next.current || null;
    typeInputs.forEach((input) => { input.checked = input.value === (current?.type || "FD"); });
    lagInput.value = String(current?.lag || 0);
    refresh();
    if (!dialog.open) dialog.showModal();
    const checked = list.querySelector('input[name="linkTask"]:checked');
    checked?.closest(".synthese-link-dialog__option")?.scrollIntoView?.({ block: "center" });
    (checked || search).focus();
  }

  return { open, close, isOpen: () => dialog.open };
}
