// Onglet « Tâche contrôlée » de la fenêtre « Paramètre » de la vue Synthese : les tâches des étages
// déjà créés du projet, rangées par cycle. On en choisit une ; l'onglet dit dans combien d'étages elle
// deviendra la tâche contrôlée par rapport au coffrage et lesquels ne l'ont pas (ils ne changent pas),
// puis « Appliquer aux étages » l'écrit tout de suite — sans passer par « Enregistrer », qui ne vaut
// que pour le modèle d'étage. La liste, ce que chaque choix changerait et l'écriture viennent du
// tableau de tâches (getSource, applyControlTask : voir getControlTaskSource et applyControlTask du
// contrôleur) ; l'onglet les montre et rend la tâche choisie. Dépendances injectées : doublures en
// test.

const MESSAGES = Object.freeze({
  help: "Choisissez la tâche contrôlée par rapport au coffrage des étages déjà créés. « Appliquer aux étages » la coche tout de suite dans chaque étage qui a cette tâche, au même nom et dans le même cycle ; un étage qui ne l'a pas n'est pas modifié. {E} remplace le nom de l'étage. Pour les étages à venir, cochez la tâche dans l'onglet « Modèle d'étage ».",
  notReady: "Les étages du projet ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.",
  noFloor: "Ce projet n'a pas encore d'étage.",
  failed: "La tâche contrôlée n'a pas pu être changée. Réessayez.",
});

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// « 2 étages », « 1 étage ».
function floorsText(count) {
  return `${count} étage${count > 1 ? "s" : ""}`;
}

// Nom montré d'une tâche : la deuxième tâche de même nom d'un cycle porte son rang, « … (2) ».
function taskLabel(choice) {
  return choice.rank > 1 ? `${choice.name} (${choice.rank})` : choice.name;
}

// Rien à écrire : la tâche est déjà la tâche contrôlée de tous les étages qui l'ont.
function nothingToChange(choice, count) {
  const where = count > 1 ? `des ${count} étages qui l'ont` : "du seul étage qui l'a";
  return { text: `Rien à changer : « ${taskLabel(choice)} » est déjà la tâche contrôlée ${where}.`, tone: "" };
}

// Avant d'appliquer : ce que le choix changerait, puis — en avertissement — les étages qui n'ont
// pas la tâche et ne seront pas modifiés. Lignes { text, tone }.
export function previewLines(choice) {
  const lines = [];
  const already = choice.current.length;
  if (choice.change.length) {
    const also = already ? ` ; elle l'est déjà dans ${floorsText(already)}` : "";
    lines.push({
      text: `« ${taskLabel(choice)} » deviendra la tâche contrôlée de ${floorsText(choice.change.length)}${also}.`,
      tone: "",
    });
  } else {
    lines.push(nothingToChange(choice, already));
  }
  const missing = choice.missing.length;
  if (missing) {
    const many = missing > 1;
    lines.push({
      text: `${floorsText(missing)} n'${many ? "ont" : "a"} pas cette tâche et ne ${many ? "seront" : "sera"} pas modifié${many ? "s" : ""} : ${choice.missing.join(", ")}.`,
      tone: "is-warning",
    });
  }
  return lines;
}

// Après l'écriture, d'après ce que le tableau a répondu (`outcome` : change, current, missing) : ce
// qui a changé, puis — en avertissement — les étages laissés tels quels faute d'avoir la tâche.
export function resultLines(choice, outcome) {
  const lines = [];
  const changed = outcome.change?.length || 0;
  const already = outcome.current?.length || 0;
  if (changed) {
    const also = already ? ` ; elle l'était déjà dans ${floorsText(already)}` : "";
    lines.push({
      text: `« ${taskLabel(choice)} » est maintenant la tâche contrôlée de ${floorsText(changed)}${also}.`,
      tone: "",
    });
  } else {
    lines.push(nothingToChange(choice, already));
  }
  const missing = outcome.missing?.length || 0;
  if (missing) {
    const many = missing > 1;
    lines.push({
      text: `${floorsText(missing)} non modifié${many ? "s" : ""}, la tâche n'y existe pas : ${outcome.missing.join(", ")}.`,
      tone: "is-warning",
    });
  }
  return lines;
}

// L'onglet, créé une fois. `show()` relit le tableau de tâches (getSource → { ready, blockedMessage,
// floorCount, choices } ou null) et redessine ; `reset()` oublie le choix et le dernier résultat
// (ouverture et fermeture de la fenêtre). `applyControlTask({ key })` rend { ok, change, current,
// missing } ou { ok: false, error } ; `onClose` : le bouton « Fermer ».
export function createControlPanel({
  doc = document,
  getSource = () => null,
  applyControlTask = async () => ({ ok: false }),
  onClose = () => {},
} = {}) {
  const element = createElement(doc, "div", "synthese-control-panel");
  const help = createElement(doc, "p", "synthese-control-panel__help", MESSAGES.help);

  const list = createElement(doc, "div", "synthese-control-panel__list");
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", "Tâches des étages du projet");

  const messages = createElement(doc, "div", "synthese-control-panel__messages");
  messages.setAttribute("role", "status");
  messages.setAttribute("aria-live", "polite");
  messages.hidden = true;

  const footer = createElement(doc, "div", "synthese-control-panel__footer");
  const closeButton = createElement(doc, "button", "synthese-button", "Fermer");
  closeButton.type = "button";
  const applyButton = createElement(doc, "button", "synthese-button synthese-button--primary", "Appliquer aux étages");
  applyButton.type = "button";
  footer.append(closeButton, applyButton);

  element.append(help, list, messages, footer);

  let source = null;
  let selectedKey = "";
  let busy = false;
  // Lignes du dernier « Appliquer » (réussite ou refus) ; effacées au choix suivant.
  let result = null;
  // Lignes de la liste : { key, row, input }.
  let options = [];
  // Change à chaque reset : une réponse arrivée après la fermeture de la fenêtre est ignorée.
  let session = 0;

  const selected = () => source?.choices?.find((choice) => choice.key === selectedKey) || null;

  // Écrire : étages lus, rien qui l'empêche, pas d'écriture en cours, et un étage au moins à changer.
  function canApply() {
    return Boolean(source?.ready) && !source.blockedMessage && !busy && (selected()?.change.length || 0) > 0;
  }

  // Sous la liste : ce qui empêche d'écrire, puis le résultat du dernier « Appliquer » ou, à défaut,
  // ce que le choix en cours changerait.
  function messageLines() {
    if (!source?.ready) return [{ text: MESSAGES.notReady, tone: "" }];
    const lines = [];
    if (!source.floorCount) lines.push({ text: MESSAGES.noFloor, tone: "" });
    else if (source.blockedMessage) lines.push({ text: source.blockedMessage, tone: "" });
    const choice = selected();
    if (result) lines.push(...result);
    else if (choice) lines.push(...previewLines(choice));
    return lines;
  }

  // Le choix coché, le bouton et les messages ; la liste n'est pas reconstruite (le clavier garde sa
  // place dans les boutons radio).
  function renderState() {
    options.forEach(({ key, row, input }) => {
      const isSelected = key === selectedKey;
      input.checked = isSelected;
      input.disabled = busy;
      row.classList.toggle("is-selected", isSelected);
    });
    applyButton.disabled = !canApply();
    const lines = messageLines();
    messages.replaceChildren(...lines.map(({ text, tone }) => (
      createElement(doc, "p", tone ? `synthese-parameter-dialog__message ${tone}` : "synthese-parameter-dialog__message", text)
    )));
    messages.hidden = !lines.length;
  }

  function select(key) {
    if (busy) return;
    selectedKey = key;
    result = null;
    renderState();
  }

  // Une tâche : bouton radio, nom, nombre d'étages qui l'ont (en évidence s'il en manque) et, si elle
  // est déjà une tâche contrôlée quelque part, dans combien d'étages.
  function buildOption(choice, level) {
    const row = createElement(doc, "label", "synthese-control-panel__option");
    row.style.setProperty("--scp-level", String(level));
    const input = createElement(doc, "input", "");
    input.type = "radio";
    input.name = "syntheseControlTask";
    input.value = choice.key;
    const name = createElement(doc, "span", "synthese-control-panel__name", taskLabel(choice));
    name.title = taskLabel(choice);
    const present = choice.change.length + choice.current.length;
    const count = createElement(doc, "span", "synthese-control-panel__count", `${floorsText(present)} sur ${source.floorCount}`);
    if (choice.missing.length) count.classList.add("is-partial");
    const state = createElement(
      doc,
      "span",
      "synthese-control-panel__state",
      choice.controlled ? `contrôlée dans ${floorsText(choice.controlled)}` : ""
    );
    row.append(input, name, count, state);
    input.addEventListener("change", () => select(choice.key));
    return { key: choice.key, row, input };
  }

  // La liste, comme le tableau : une ligne par cycle (chaque niveau en retrait), ses tâches dessous.
  function buildList() {
    const nodes = [];
    options = [];
    let open = [];
    (source?.ready ? source.choices : []).forEach((choice) => {
      const path = choice.path || [];
      let shared = 0;
      while (shared < open.length && shared < path.length && open[shared] === path[shared]) shared += 1;
      path.slice(shared).forEach((groupName, index) => {
        const group = createElement(doc, "div", "synthese-control-panel__group", groupName);
        group.style.setProperty("--scp-level", String(shared + index));
        nodes.push(group);
      });
      open = path;
      const option = buildOption(choice, path.length);
      options.push(option);
      nodes.push(option.row);
    });
    list.replaceChildren(...nodes);
    list.hidden = !nodes.length;
  }

  // Le tableau relu : un choix dont la tâche a disparu est oublié.
  function refresh() {
    source = getSource() || null;
    if (!selected()) selectedKey = "";
    buildList();
    renderState();
  }

  async function apply() {
    const choice = selected();
    if (!choice || !canApply()) return;
    const current = session;
    busy = true;
    result = null;
    renderState();
    let outcome;
    try {
      outcome = await applyControlTask({ key: choice.key });
    } catch (error) {
      console.error("Tâche contrôlée non changée :", error);
      outcome = { ok: false, error: error?.userMessage || MESSAGES.failed };
    }
    if (session !== current) return;
    busy = false;
    result = outcome?.ok
      ? resultLines(choice, outcome)
      : [{ text: outcome?.error || MESSAGES.failed, tone: "is-error" }];
    refresh();
  }

  closeButton.addEventListener("click", () => onClose());
  applyButton.addEventListener("click", () => {
    if (!applyButton.disabled) void apply();
  });

  return {
    element,
    show() {
      refresh();
    },
    reset() {
      session += 1;
      source = null;
      selectedKey = "";
      busy = false;
      result = null;
      buildList();
      renderState();
    },
  };
}
