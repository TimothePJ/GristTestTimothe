// Fenêtre « Ajouter un étage » de la vue Synthese en affichage par étage, ouverte par le clic droit :
// on y nomme l'étage et on coche les zones qui le reçoivent. Une zone qui a déjà un étage de ce nom
// est grisée (« déjà présent »), au fil de la saisie. Les zones, les noms pris et les règles de
// validation viennent du contrôleur (voir handleAddStorey) ; la fenêtre ne fait que les montrer et
// rendre le nom et les zones choisis. Sous la liste, « Nouvelle zone » ajoute une zone cochée
// (mention « nouvelle ») que le contrôleur créera avec l'étage. Elle reprend le style de la fenêtre
// de lien.

const TAKEN_NOTE = "déjà présent";
const NEW_NOTE = "nouvelle";

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// La fenêtre, créée une fois (dans `doc.body`). `open(model)` la montre — model :
// { name, zones: [{ zoneKey, label }], checked: [zoneKey], takenZones(name) → Set de zoneKey,
// checkZoneName(raw) → { ok, error? | existing, zoneKey, label }, validate(name, zoneKeys, newZones)
// → { ok, error? } } — et `onSubmit({ name, zoneKeys, newZones })` reçoit le choix validé (newZones :
// les noms des nouvelles zones cochées, dans l'ordre d'ajout).
export function createFloorDialog({ doc = document, onSubmit = () => {} } = {}) {
  const dialog = createElement(doc, "dialog", "synthese-link-dialog synthese-floor-dialog");
  dialog.setAttribute("aria-labelledby", "syntheseFloorDialogTitle");
  const form = createElement(doc, "form", "synthese-link-dialog__form");
  form.method = "dialog";
  form.noValidate = true;

  const header = createElement(doc, "div", "synthese-link-dialog__header");
  const title = createElement(doc, "h3", "", "Ajouter un étage");
  title.id = "syntheseFloorDialogTitle";
  const closeButton = createElement(doc, "button", "synthese-link-dialog__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Fermer");
  header.append(title, closeButton);

  const nameLabel = createElement(doc, "label", "synthese-link-dialog__label", "Nom de l'étage");
  nameLabel.htmlFor = "syntheseFloorDialogName";
  const nameInput = createElement(doc, "input", "synthese-link-dialog__search");
  nameInput.type = "text";
  nameInput.id = "syntheseFloorDialogName";
  nameInput.autocomplete = "off";

  const zonesLabel = createElement(doc, "p", "synthese-link-dialog__label", "Zones");
  const list = createElement(doc, "div", "synthese-link-dialog__list");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Zones");

  const newZoneLabel = createElement(doc, "label", "synthese-link-dialog__label", "Nouvelle zone");
  newZoneLabel.htmlFor = "syntheseFloorDialogNewZone";
  const newZoneRow = createElement(doc, "div", "synthese-floor-dialog__new");
  const newZoneInput = createElement(doc, "input", "synthese-link-dialog__search");
  newZoneInput.type = "text";
  newZoneInput.id = "syntheseFloorDialogNewZone";
  newZoneInput.autocomplete = "off";
  const addZoneButton = createElement(doc, "button", "synthese-floor-dialog__add", "Ajouter la zone");
  addZoneButton.type = "button";
  newZoneRow.append(newZoneInput, addZoneButton);

  const error = createElement(doc, "p", "synthese-link-dialog__error");
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = createElement(doc, "div", "synthese-link-dialog__actions");
  const cancelButton = createElement(doc, "button", "synthese-link-dialog__cancel", "Annuler");
  cancelButton.type = "button";
  const submitButton = createElement(doc, "button", "synthese-link-dialog__submit", "Créer");
  submitButton.type = "submit";
  actions.append(cancelButton, submitButton);

  form.append(header, nameLabel, nameInput, zonesLabel, list, newZoneLabel, newZoneRow, error, actions);
  dialog.appendChild(form);
  doc.body.appendChild(dialog);

  let model = null;
  // Zones que l'utilisateur veut cocher (existantes et nouvelles) : une zone grisée par un nom pris
  // est décochée, et se recoche d'elle-même si le nom change.
  let wanted = new Set();
  let rows = [];

  // Ligne de message : un refus en rouge, une simple information (`info`) en texte normal.
  function showError(text, { info = false } = {}) {
    error.textContent = text || "";
    error.hidden = !text;
    error.classList.toggle("is-info", Boolean(text) && info);
  }

  // Zones grisées d'après le nom saisi, cases, et « Créer » (nom non vide, une zone cochée au moins).
  function refresh() {
    const taken = model?.takenZones ? model.takenZones(nameInput.value) : new Set();
    let anyChecked = false;
    rows.forEach(({ zoneKey, row, input, note, isNew }) => {
      const isTaken = !isNew && taken.has(zoneKey);
      input.disabled = isTaken;
      input.checked = !isTaken && wanted.has(zoneKey);
      note.hidden = !isNew && !isTaken;
      row.classList.toggle("is-disabled", isTaken);
      anyChecked ||= input.checked;
    });
    submitButton.disabled = !nameInput.value.trim() || !anyChecked;
  }

  // Une ligne de la liste : case, nom, mention (« déjà présent » masquée par défaut, ou « nouvelle »).
  function buildRow({ zoneKey, label }, isNew = false) {
    const row = createElement(doc, "label", "synthese-floor-dialog__zone");
    const input = createElement(doc, "input", "");
    input.type = "checkbox";
    input.value = zoneKey;
    const text = createElement(doc, "span", "", label);
    const note = createElement(doc, "span", "synthese-floor-dialog__note", isNew ? NEW_NOTE : TAKEN_NOTE);
    note.hidden = !isNew;
    row.append(input, text, note);
    return { zoneKey, label, row, input, note, isNew };
  }

  function renderZones() {
    rows = (model?.zones || []).map((zone) => buildRow(zone));
    list.replaceChildren(...rows.map(({ row }) => row));
  }

  // « Ajouter la zone » : une zone du projet est simplement cochée (avec le motif si elle ne peut
  // l'être) ; un nom neuf donne une ligne cochée « nouvelle » ; un refus garde la saisie.
  function addZone() {
    if (!model) return;
    const result = model.checkZoneName(newZoneInput.value);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    let target = rows.find(({ zoneKey }) => zoneKey === result.zoneKey);
    showError("");
    if (!target) {
      target = buildRow(result, true);
      rows.push(target);
      list.appendChild(target.row);
    }
    wanted.add(target.zoneKey);
    newZoneInput.value = "";
    refresh();
    if (!target.isNew) {
      if (target.input.disabled) showError(`La zone « ${target.label} » a déjà l'étage « ${nameInput.value.trim()} ».`);
      else showError(`La zone « ${target.label} » existe déjà : elle est cochée.`, { info: true });
    }
  }

  nameInput.addEventListener("input", () => {
    showError("");
    refresh();
  });
  newZoneInput.addEventListener("input", () => showError(""));
  newZoneInput.addEventListener("keydown", (event) => {
    // Entrée valide la zone tapée, jamais la fenêtre (ni pendant une saisie IME en cours).
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    addZone();
  });
  addZoneButton.addEventListener("click", addZone);
  list.addEventListener("change", (event) => {
    const input = event.target;
    if (input?.type !== "checkbox") return;
    if (input.checked) wanted.add(input.value);
    else wanted.delete(input.value);
    showError("");
    refresh();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!model || submitButton.disabled) return;
    const name = nameInput.value.trim();
    const chosen = rows.filter(({ input }) => input.checked && !input.disabled);
    const zoneKeys = chosen.filter(({ isNew }) => !isNew).map(({ zoneKey }) => zoneKey);
    const newZones = chosen.filter(({ isNew }) => isNew).map(({ label }) => label);
    const result = model.validate(name, zoneKeys, newZones);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    close();
    void onSubmit({ name, zoneKeys, newZones });
  });
  cancelButton.addEventListener("click", () => close());
  closeButton.addEventListener("click", () => close());
  // Échap : la fenêtre se ferme sans rien créer.
  dialog.addEventListener("cancel", () => { model = null; });

  function close() {
    model = null;
    if (dialog.open) dialog.close();
  }

  function open(next) {
    model = next;
    wanted = new Set(next.checked || []);
    // Le nom proposé (« Nouvel étage »…) n'est qu'une indication grisée : le champ part vide et la
    // saisie la remplace ; « Créer » attend un nom tapé.
    nameInput.value = "";
    nameInput.placeholder = next.name || "";
    newZoneInput.value = "";
    showError("");
    renderZones();
    refresh();
    if (!dialog.open) dialog.showModal();
    nameInput.focus();
  }

  return { open, close, isOpen: () => dialog.open };
}
