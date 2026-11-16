// Fenêtre « Paramètre » de la vue Synthese : le modèle d'étage du projet (les lignes, liens et durées
// qu'un nouvel étage reçoit), modifié avec les gestes mêmes du tableau Synthese. Aucun geste n'est
// réécrit : la fenêtre fait tourner une seconde instance du vrai tableau et du vrai contrôleur,
// branchée sur des lignes en mémoire (datées depuis le lundi fictif) et sur un faux docApi. Rien ne
// part vers Grist pendant la saisie : « Enregistrer » rend le texte JSON du modèle à `onSave`, qui
// l'écrit dans Projets2 (main.js). Ses dépendances sont injectées (document, confirmation, fabriques
// du contrôleur et du tableau) : doublures en test.
import { createSyntheseTasksController } from "./syntheseTasksController.js";
import { createSyntheseTaskTable } from "./syntheseTaskTable.js";
import { createLinkDialog } from "./syntheseLinkDialog.js";
import { createMemoryDocApi } from "../services/memoryDocApi.js";
import { FLOOR_TEMPLATE } from "../services/syntheseFloorTemplate.js";
import { NATURES } from "../services/syntheseTaskModel.js";
import {
  MODEL_PROJECT_NAME,
  serializeFloorTemplate,
  templateItemsFromRows,
  templateToRows,
  templateWarnings,
} from "../services/syntheseFloorParameter.js";

const TITLE = "Paramètre — modèle d'étage";
const MESSAGES = Object.freeze({
  help: "Un nouvel étage de ce projet reçoit ces lignes, ces liens et ces durées. {E} est remplacé par le nom de l'étage. Les étages déjà créés ne changent pas.",
  abandon: "Abandonner les modifications du modèle ?",
  noTask: "Le modèle doit garder au moins une tâche.",
  noColumn: "Créez la colonne Texte « Synthese_Parametre » dans Projets2 pour enregistrer un modèle.",
  invalid: "Le modèle enregistré est illisible : modèle d'origine affiché.",
  readOnly: "Lecture seule : il faut « Editer » actif et le droit de changer la Synthese pour modifier ce modèle.",
  saveFailed: "Le modèle n'a pas pu être enregistré dans Projets2. Réessayez.",
});

// Options de l'instance du tableau : ni Début ni Fin, pas de Gantt, menus et étage du mode modèle,
// largeurs mémorisées à part de celles du tableau principal.
function tableOptions() {
  return {
    hiddenFields: ["start", "end"],
    rightPane: false,
    templateMode: true,
    storageKeys: {
      leftWidth: "planning-projet.synthese-parametre.left-width",
      columnWidths: "planning-projet.synthese-parametre.column-widths",
    },
  };
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

const isTaskItem = (item) => item.nature !== NATURES.cycle && item.nature !== NATURES.subgroup;

// La fenêtre, créée une fois (dans `doc.body`). `open(model)` la montre — model : { projectName,
// items (éléments du modèle), invalid (paramètre illisible), canEdit, columnMissing } — et
// `onSave(text)` reçoit le JSON à écrire : la fenêtre se ferme quand la promesse est résolue, et
// affiche l'erreur si elle est rejetée. `setCanEdit` suit « Editer » pendant qu'elle est ouverte.
export function createParameterDialog({
  doc = document,
  confirm = (message) => window.confirm(message),
  onSave = async () => {},
  createController = createSyntheseTasksController,
  createTable = createSyntheseTaskTable,
} = {}) {
  function createElement(tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function createButton(className, text) {
    const button = createElement("button", className, text);
    button.type = "button";
    return button;
  }

  const dialog = createElement("dialog", "synthese-link-dialog synthese-parameter-dialog");
  dialog.setAttribute("aria-labelledby", "syntheseParameterDialogTitle");

  const header = createElement("div", "synthese-link-dialog__header");
  const title = createElement("h3", "", TITLE);
  title.id = "syntheseParameterDialogTitle";
  const closeButton = createButton("synthese-link-dialog__close", "×");
  closeButton.setAttribute("aria-label", "Fermer");
  header.append(title, closeButton);

  const help = createElement("p", "synthese-parameter-dialog__help", MESSAGES.help);
  // Hôte du tableau : chaque instance (ouverture, retour au modèle d'origine) y remplace la précédente.
  const host = createElement("div", "synthese-parameter-dialog__table");

  const messages = createElement("div", "synthese-parameter-dialog__messages");
  messages.setAttribute("role", "status");
  messages.setAttribute("aria-live", "polite");
  messages.hidden = true;

  const footer = createElement("div", "synthese-parameter-dialog__footer");
  const revertButton = createButton("synthese-button", "Revenir au modèle d'origine");
  const actions = createElement("div", "synthese-parameter-dialog__actions");
  const cancelButton = createButton("synthese-button", "Annuler");
  const saveButton = createButton("synthese-button synthese-button--primary", "Enregistrer");
  actions.append(cancelButton, saveButton);
  footer.append(revertButton, actions);

  dialog.append(header, help, host, messages, footer);
  doc.body.appendChild(dialog);

  // Instance en cours : { memory, controller } ; null fenêtre fermée.
  let session = null;
  let projectName = "";
  let canEdit = false;
  let columnMissing = false;
  let invalid = false;
  // Modifié depuis l'ouverture (une écriture acceptée par le faux docApi, ou le retour au modèle
  // d'origine) : l'abandon se confirme.
  let dirty = false;
  let saving = false;
  // Refus ou erreur du dernier « Enregistrer » ; effacé au geste suivant.
  let errorText = "";
  let warnings = [];

  // Modifier et enregistrer : « Editer » actif dans un service modifiable (canEdit, fourni par
  // main.js) et colonne Synthese_Parametre présente.
  const editable = () => canEdit && !columnMissing;

  // Une seule fenêtre « Lien de la tâche » pour toutes les instances : chaque contrôleur (un par
  // ouverture) y branche sa validation, dans le document de la fenêtre.
  let linkDialog = null;
  let linkSubmit = null;
  function sharedLinkDialog({ onSubmit }) {
    linkSubmit = onSubmit;
    linkDialog ||= createLinkDialog({ doc, onSubmit: (link) => linkSubmit?.(link) });
    return linkDialog;
  }

  // Boutons et zone de message : refus ou erreur, état du modèle, droits, puis avertissements.
  function renderState() {
    const allowed = editable() && !saving;
    saveButton.disabled = !allowed;
    revertButton.disabled = !allowed;
    host.classList.toggle("is-busy", saving);
    const lines = [];
    if (errorText) lines.push({ text: errorText, tone: "is-error" });
    if (invalid) lines.push({ text: MESSAGES.invalid, tone: "is-warning" });
    if (columnMissing) lines.push({ text: MESSAGES.noColumn, tone: "" });
    else if (!canEdit) lines.push({ text: MESSAGES.readOnly, tone: "" });
    warnings.forEach((text) => lines.push({ text, tone: "is-warning" }));
    messages.replaceChildren(...lines.map(({ text, tone }) => (
      createElement("p", tone ? `synthese-parameter-dialog__message ${tone}` : "synthese-parameter-dialog__message", text)
    )));
    messages.hidden = !lines.length;
  }

  // Une instance du tableau et du contrôleur sur les lignes en mémoire du modèle `items`. Le faux
  // contexte ne connaît que le projet fictif de la fenêtre ; le faux docApi prévient après chaque
  // écriture, et la fenêtre relit alors ses lignes (dans le tableau principal, c'est la surveillance
  // de main.js qui le fait).
  function mount(items) {
    let current = null;
    const memory = createMemoryDocApi({
      rows: templateToRows(items),
      defaults: { Service: "Synthese", NomProjet: MODEL_PROJECT_NAME },
      onChange: () => {
        if (!current || session !== current) return;
        dirty = true;
        errorText = "";
        warnings = templateWarnings(memory.getRows());
        renderState();
        void current.controller.refresh();
      },
    });
    const context = {
      getState: () => ({
        currentProject: { name: MODEL_PROJECT_NAME, names: [MODEL_PROJECT_NAME] },
        selectedService: "Synthese",
        accessMode: editable() ? "editable" : "readonly",
      }),
      fetchContextRows: async () => memory.getRows(),
      fetchProjectRows: async () => [],
      subscribe: () => () => {},
      watchProjectZones: () => () => {},
    };
    const controller = createController({
      context,
      docApi: memory,
      confirm,
      createTable: (callbacks) => createTable(host, callbacks, tableOptions()),
      loadFormworkStarts: null,
      saveLayout: null,
      createLinkDialog: sharedLinkDialog,
      // La ligne de zone est masquée : les numéros de ligne partent de l'étage.
      skipZoneLines: true,
    });
    current = { memory, controller };
    session = current;
    warnings = templateWarnings(memory.getRows());
    controller.setEditingEnabled(editable());
    controller.setActive(true);
  }

  // L'instance est arrêtée et oubliée ; son tableau quitte la fenêtre.
  function unmount() {
    const current = session;
    session = null;
    current?.controller.setActive(false);
    // La fenêtre « Lien de la tâche » partagée ne reste pas orpheline au-dessus d'une fenêtre fermée.
    linkDialog?.close?.();
    host.replaceChildren();
  }

  // Fermeture sans question : « Enregistrer » réussi, ou projet / service changé (main.js).
  function close() {
    unmount();
    projectName = "";
    dirty = false;
    saving = false;
    errorText = "";
    warnings = [];
    invalid = false;
    if (dialog.open) dialog.close();
  }

  // ×, Échap, « Annuler » : des modifications non enregistrées se confirment.
  function requestClose() {
    if (session && dirty && !confirm(MESSAGES.abandon)) return;
    close();
  }

  function open(model = {}) {
    if (session) unmount();
    projectName = toText(model.projectName);
    canEdit = model.canEdit === true;
    columnMissing = model.columnMissing === true;
    invalid = model.invalid === true;
    dirty = false;
    saving = false;
    errorText = "";
    // Colonne absente ou paramètre illisible : le modèle d'origine.
    const items = !columnMissing && !invalid && Array.isArray(model.items) && model.items.length
      ? model.items
      : FLOOR_TEMPLATE;
    title.textContent = projectName ? `${TITLE} · ${projectName}` : TITLE;
    if (!dialog.open) dialog.showModal();
    mount(items);
    renderState();
  }

  // « Revenir au modèle d'origine » : le contenu devient FLOOR_TEMPLATE, rien n'est enregistré.
  function revert() {
    if (!session || saving || !editable()) return;
    unmount();
    mount(FLOOR_TEMPLATE);
    dirty = true;
    errorText = "";
    renderState();
  }

  // « Enregistrer » : la file du contrôleur d'abord vidée (une saisie à peine validée y attend encore),
  // les droits revérifiés, puis le modèle relu des lignes en mémoire et rendu à onSave.
  async function save() {
    const current = session;
    if (!current || saving || !editable()) return;
    saving = true;
    errorText = "";
    renderState();
    try {
      await current.controller.whenIdle();
      if (session !== current || !editable()) return;
      const items = templateItemsFromRows(current.memory.getRows());
      if (!items.some(isTaskItem)) {
        errorText = MESSAGES.noTask;
        return;
      }
      await onSave(serializeFloorTemplate(items));
      if (session === current) close();
    } catch (error) {
      console.error("Modèle d'étage non enregistré :", error);
      if (session === current) errorText = error?.userMessage || MESSAGES.saveFailed;
    } finally {
      if (session === current) {
        saving = false;
        renderState();
      }
    }
  }

  closeButton.addEventListener("click", () => requestClose());
  cancelButton.addEventListener("click", () => requestClose());
  revertButton.addEventListener("click", () => revert());
  saveButton.addEventListener("click", () => {
    if (!saveButton.disabled) void save();
  });
  // Échap : même règle que « Annuler » ; la fenêtre ne se ferme que si on le confirme.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  // Fermée par le navigateur sans passer par la fenêtre (second Échap sans activation, malgré
  // preventDefault sur « cancel ») : avec des modifications, la fenêtre se rouvre et garde sa session.
  // Seule la fermeture de la fenêtre elle-même (close) efface la session avant de fermer le dialogue.
  dialog.addEventListener("close", () => {
    if (!session) return;
    if (dirty) {
      dialog.showModal();
      return;
    }
    close();
  });

  return {
    open,
    close,
    setCanEdit(next) {
      canEdit = Boolean(next);
      if (!session) return;
      session.controller.setEditingEnabled(editable());
      renderState();
    },
    isOpen: () => Boolean(dialog.open),
    openedProject: () => (session ? projectName : ""),
  };
}
