// Fenêtre « Lien Structure » de la vue Synthese : zone par zone, les étages de Synthese à
// gauche et les coffrages de Structure à droite. On glisse un coffrage sur un étage de sa
// zone : l'étage retient son N° et prend sa date de diffusion à l'indice 0. Les étages viennent
// du tableau de tâches (lignes telles qu'affichées) ; les coffrages et la liste de plans sont
// lus à chaque ouverture ; toute écriture passe par le tableau de tâches. Ses dépendances sont
// injectées (éléments, lectures, écriture, nom du projet) : doublures en test.
import { LINK_STATES, buildStructureLink } from "../services/structureLinkModel.js";
import { formatDate } from "../services/syntheseTaskModel.js";

const TITLE = "Lien Structure";
// Type de la donnée glissée. Privé : le planning Structure écoute tous les glisser de la page
// et prend un « text/plain » pour une ligne MS Project.
const DRAG_TYPE = "application/x-planning-coffrage";
const MESSAGES = Object.freeze({
  noProject: "Choisissez d'abord un projet.",
  loading: "Chargement…",
  noZone: "Aucune zone pour ce projet.",
  readFailed: "Les étages et les coffrages n'ont pas pu être lus. Fermez la fenêtre puis rouvrez-la.",
  notReady: "Les étages ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.",
  projectChanged: "Le projet a changé depuis l'ouverture de cette fenêtre : fermez-la puis rouvrez-la.",
  noLinkColumn: "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.",
  hint: "Faites glisser un coffrage sur un étage de la même zone.",
  saving: "Enregistrement…",
  writeFailed: "L'enregistrement dans Grist a échoué. Réessayez.",
  redrawFailed: "L'enregistrement est fait, mais l'affichage n'a pas pu être mis à jour : fermez la fenêtre puis rouvrez-la.",
  noFloor: "Aucun étage",
  noFormwork: "Aucun coffrage",
  dropHere: "Déposez un coffrage ici",
  noLink: "Aucun coffrage lié",
  noIssue: "pas d'indice 0",
  refresh: "Mettre à jour",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// L'élément portant la classe, à partir de la cible d'un évènement (un nœud de texte n'a pas
// de closest : on part de son parent).
function closestOf(target, className) {
  const element = typeof target?.closest === "function" ? target : target?.parentElement;
  return element?.closest?.(`.${className}`) || null;
}

// Texte du lien d'un étage, selon son état.
function linkText(floor, editable) {
  const label = floor.formwork?.label || "";
  switch (floor.state) {
    case LINK_STATES.missing:
      return `Coffrage ${floor.formworkNumber} introuvable`;
    case LINK_STATES.noPlan:
      return `${label} · pas de tâche « FOND DE PLAN DE SYNTHESE » dans cet étage`;
    case LINK_STATES.waiting:
      return `${label} · en attente de l'indice 0`;
    case LINK_STATES.current:
      return `${label} · à jour`;
    case LINK_STATES.stale:
      return `${label} · à mettre à jour : ind. 0 le ${formatDate(floor.formwork?.issueDate)}`;
    default:
      return editable ? MESSAGES.dropHere : MESSAGES.noLink;
  }
}

// Un étage : son nom, le début de son fond de plan, son lien et, si l'on peut écrire, ses
// boutons (« Mettre à jour » quand la date diffère, « × » pour délier).
function buildFloor(doc, zone, floor, editable) {
  const item = createElement(doc, "li", `structure-link-item structure-link-floor is-state-${floor.state}`);
  item.dataset.zoneKey = zone.zoneKey;
  item.dataset.floorKey = floor.key;
  item.appendChild(createElement(doc, "span", "structure-link-floor-name", floor.name));
  if (floor.plan) {
    item.appendChild(createElement(doc, "span", "structure-link-plan", `Fond de plan : début ${formatDate(floor.plan.start)}`));
  }
  const row = createElement(doc, "div", "structure-link-linkrow");
  row.appendChild(createElement(doc, "span", "structure-link-link", linkText(floor, editable)));
  if (editable && floor.state === LINK_STATES.stale) {
    const refresh = createElement(doc, "button", "structure-link-action", MESSAGES.refresh);
    refresh.type = "button";
    refresh.dataset.action = "refresh";
    row.appendChild(refresh);
  }
  if (editable && floor.state !== LINK_STATES.none) {
    const unlink = createElement(doc, "button", "structure-link-action structure-link-unlink", "×");
    unlink.type = "button";
    unlink.dataset.action = "unlink";
    unlink.title = `Délier ${floor.name}`;
    unlink.setAttribute("aria-label", `Délier ${floor.name}`);
    row.appendChild(unlink);
  }
  item.appendChild(row);
  return item;
}

// Un coffrage : « N° — nom », sa date d'indice 0, les étages qu'il sert. Il se déplace si l'on
// peut écrire et s'il a un N°.
function buildFormwork(doc, zone, formwork, editable) {
  const item = createElement(doc, "li", "structure-link-item structure-link-formwork");
  item.dataset.zoneKey = zone.zoneKey;
  item.dataset.number = formwork.number;
  item.appendChild(createElement(doc, "span", "structure-link-formwork-label", formwork.label));
  item.appendChild(createElement(
    doc,
    "span",
    "structure-link-issue",
    formwork.issueDate ? `ind. 0 : ${formatDate(formwork.issueDate)}` : MESSAGES.noIssue
  ));
  const floorNames = formwork.floorNames || [];
  if (floorNames.length) {
    item.appendChild(createElement(doc, "span", "structure-link-used", `lié : ${floorNames.join(", ")}`));
  }
  if (editable && formwork.number) {
    item.draggable = true;
    item.classList.add("is-draggable");
  }
  return item;
}

// Un côté d'une zone : le nom de la zone, puis ses éléments (ou la mention qu'il n'y en a pas).
function buildSide(doc, { modifier, zoneLabel, listLabel, items, emptyText }) {
  const side = createElement(doc, "div", `structure-link-side structure-link-side--${modifier}`);
  side.appendChild(createElement(doc, "div", "structure-link-zone-name", zoneLabel));
  const list = createElement(doc, "ul", "structure-link-list");
  list.setAttribute("aria-label", `${listLabel} — ${zoneLabel}`);
  if (items.length) {
    items.forEach((item) => list.appendChild(item));
  } else {
    list.appendChild(createElement(doc, "li", "structure-link-empty", emptyText));
  }
  side.appendChild(list);
  return side;
}

// Dessine le modèle dans le corps de la fenêtre : une rangée par zone, les deux côtés en face.
// Renvoie les éléments des étages et des coffrages (repères du glisser-déposer).
export function renderStructureLink(body, model, { editable = false, doc = document } = {}) {
  const floors = [];
  const formworks = [];
  const zones = (model?.zones || []).map((zone) => {
    const floorItems = (zone.floors || []).map((floor) => buildFloor(doc, zone, floor, editable));
    const formworkItems = (zone.formworks || []).map((formwork) => buildFormwork(doc, zone, formwork, editable));
    floors.push(...floorItems);
    formworks.push(...formworkItems);
    const row = createElement(doc, "div", "structure-link-zone");
    row.appendChild(buildSide(doc, {
      modifier: "synthese",
      zoneLabel: zone.label,
      listLabel: "Étages de Synthèse",
      items: floorItems,
      emptyText: MESSAGES.noFloor,
    }));
    row.appendChild(buildSide(doc, {
      modifier: "structure",
      zoneLabel: zone.label,
      listLabel: "Coffrages de Structure",
      items: formworkItems,
      emptyText: MESSAGES.noFormwork,
    }));
    return row;
  });
  body.replaceChildren(...zones);
  return { floors, formworks };
}

export function createStructureLinkDialog({ dialog, title, status, body, closeButton }, {
  loadRows,
  getSource = () => null,
  applyLink = async () => ({ ok: false, error: MESSAGES.writeFailed }),
  getProjectName = () => "",
  doc = document,
} = {}) {
  // Jeton de lecture : une réponse arrivée après une fermeture ou une réouverture est ignorée.
  let loadToken = 0;
  // Projet pour lequel la fenêtre a été ouverte : ses étages et ses coffrages sont les siens.
  let openedProject = "";
  // Coffrages et liste de plans lus à l'ouverture ; null tant que la lecture n'est pas finie.
  let data = null;
  let model = { zones: [] };
  let editable = false;
  let elements = { floors: [], formworks: [] };
  // Coffrage en cours de glisser (sa zone, son N°) et étage survolé.
  let drag = null;
  let hover = null;
  // Une écriture est en route : ni nouveau glisser ni bouton avant sa réponse.
  let busy = false;

  function setStatus(text, tone = "info") {
    status.textContent = text;
    status.hidden = !text;
    if (tone === "error") status.classList.add("is-error");
    else status.classList.remove("is-error");
  }

  function setBusy(next) {
    busy = next;
    if (busy) body.classList.add("is-busy");
    else body.classList.remove("is-busy");
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  // Projet ou service changé ailleurs : une fenêtre ouverte pour un autre projet se ferme.
  function closeIfStale() {
    if (dialog.open && toText(getProjectName()) !== openedProject) close();
  }

  function endDrag() {
    drag = null;
    hover = null;
    elements.formworks.forEach((element) => element.classList.remove("is-dragging"));
    elements.floors.forEach((element) => element.classList.remove("is-droppable", "is-drop-target"));
  }

  // Redessine à partir du tableau de tâches (lignes affichées) et de la lecture de l'ouverture.
  // Renvoie la source utilisée, ou null si rien n'a pu être dessiné.
  function redraw() {
    const source = getSource();
    if (!data || !source?.ready) return null;
    endDrag();
    model = buildStructureLink({ syntheseRows: source.rows, projectRows: data.projectRows, planRows: data.planRows });
    editable = Boolean(source.editable) && source.linkColumn !== false;
    elements = renderStructureLink(body, model, { editable, doc });
    return source;
  }

  function findZone(zoneKey) {
    return model.zones.find((zone) => zone.zoneKey === zoneKey) || null;
  }

  function findFloor(zoneKey, floorKey) {
    return findZone(zoneKey)?.floors.find((floor) => floor.key === floorKey) || null;
  }

  function findFormwork(zoneKey, number) {
    return findZone(zoneKey)?.formworks.find((formwork) => formwork.number === number) || null;
  }

  // Redessin au fil d'une action. S'il échoue, l'écriture n'est pas en cause : l'erreur est
  // tracée ici et signalée à part.
  function redrawForAction() {
    try {
      redraw();
      return true;
    } catch (error) {
      console.error("Affichage du lien Structure impossible :", error);
      return false;
    }
  }

  // Une action : envoyée au tableau de tâches, affichée tout de suite, puis confirmée — ou
  // défaite — à la réponse de Grist. Jusqu'à cette réponse, la fenêtre n'accepte ni nouveau
  // glisser ni bouton : un redessin ne coupe jamais un glisser en cours, et les messages de
  // deux actions ne se recouvrent pas.
  async function act(request, successText) {
    // Le projet a changé sous la fenêtre (autre widget, autre onglet) : elle montre encore les
    // étages et les coffrages de l'ancien, rien ne doit partir vers le nouveau.
    if (toText(getProjectName()) !== openedProject) {
      setStatus(MESSAGES.projectChanged, "error");
      return;
    }
    const token = loadToken;
    setStatus(MESSAGES.saving);
    setBusy(true);
    // L'issue de l'écriture est recueillie à part des redessins : un affichage qui échoue ne
    // la fait pas passer pour refusée, et un refus tardif est toujours rattrapé.
    let pending;
    try {
      pending = Promise.resolve(applyLink(request));
    } catch (error) {
      pending = Promise.reject(error);
    }
    const outcome = pending.catch((error) => {
      console.error("Lien Structure impossible :", error);
      return { ok: false, error: MESSAGES.writeFailed };
    });
    redrawForAction();
    const result = await outcome;
    setBusy(false);
    if (!dialog.open) return;
    const drawn = redrawForAction();
    // Fenêtre rouverte entre-temps : l'affichage est à jour, le message d'une action passée
    // n'a plus sa place.
    if (token !== loadToken) return;
    if (!result?.ok) setStatus(toText(result?.error) || MESSAGES.writeFailed, "error");
    else if (!drawn) setStatus(MESSAGES.redrawFailed, "error");
    else setStatus(successText());
  }

  // Dépôt : le lien, et la date d'indice 0 si le coffrage en a une et l'étage un fond de plan.
  function link(zoneKey, floorKey, number) {
    const floor = findFloor(zoneKey, floorKey);
    const formwork = findFormwork(zoneKey, number);
    if (!floor || !formwork) return Promise.resolve();
    const date = floor.plan && formwork.issueDate ? formwork.issueDate : null;
    const request = { zoneKey, floorKey, formworkNumber: formwork.number };
    if (date) request.date = date;
    return act(request, () => {
      const linked = `${floor.name} lié au coffrage ${formwork.number}`;
      if (date) return `${linked} : le fond de plan débute le ${formatDate(findFloor(zoneKey, floorKey)?.plan?.start)}.`;
      if (!floor.plan) return `${linked}. Aucune date posée : l'étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE ».`;
      return `${linked}. La date sera à reprendre quand l'indice 0 sera diffusé.`;
    });
  }

  function refresh(zoneKey, floorKey) {
    const floor = findFloor(zoneKey, floorKey);
    const date = floor?.formwork?.issueDate;
    if (!floor?.plan || !date) return Promise.resolve();
    return act({ zoneKey, floorKey, date }, () => (
      `${floor.name} : le fond de plan débute le ${formatDate(findFloor(zoneKey, floorKey)?.plan?.start)}.`
    ));
  }

  function unlink(zoneKey, floorKey) {
    const floor = findFloor(zoneKey, floorKey);
    if (!floor) return Promise.resolve();
    return act({ zoneKey, floorKey, formworkNumber: "" }, () => `${floor.name} n'est plus lié à un coffrage.`);
  }

  async function open() {
    loadToken += 1;
    const token = loadToken;
    const projectName = toText(getProjectName());
    openedProject = projectName;
    title.textContent = projectName ? `${TITLE} — ${projectName}` : TITLE;
    data = null;
    model = { zones: [] };
    editable = false;
    elements = { floors: [], formworks: [] };
    drag = null;
    hover = null;
    body.replaceChildren();
    if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    if (!projectName) {
      setStatus(MESSAGES.noProject);
      return;
    }
    setStatus(MESSAGES.loading);
    let loaded;
    try {
      loaded = await loadRows();
    } catch (error) {
      if (token !== loadToken) return;
      console.error("Lecture des étages et des coffrages impossible :", error);
      setStatus(MESSAGES.readFailed, "error");
      return;
    }
    if (token !== loadToken) return;
    data = {
      projectRows: Array.isArray(loaded?.projectRows) ? loaded.projectRows : [],
      planRows: Array.isArray(loaded?.planRows) ? loaded.planRows : [],
    };
    const source = redraw();
    if (!source) {
      data = null;
      setStatus(MESSAGES.notReady, "error");
      return;
    }
    if (!model.zones.length) {
      setStatus(MESSAGES.noZone);
      return;
    }
    if (source.linkColumn === false) setStatus(MESSAGES.noLinkColumn, "error");
    else if (!source.editable) setStatus(toText(source.lockedMessage));
    else setStatus(MESSAGES.hint);
  }

  // L'étage survolé, s'il accepte le coffrage glissé (même zone).
  function dropFloorOf(event) {
    if (!drag) return null;
    const floor = closestOf(event.target, "structure-link-floor");
    return floor && floor.dataset.zoneKey === drag.zoneKey ? floor : null;
  }

  function setHover(floor) {
    if (floor === hover) return;
    hover?.classList.remove("is-drop-target");
    hover = floor;
    hover?.classList.add("is-drop-target");
  }

  body.addEventListener("dragstart", (event) => {
    // Glisser déjà annulé par un autre écouteur de la page : il ne démarrera pas.
    if (event.defaultPrevented) return;
    if (busy) {
      // Écriture en route : le glisser ne démarre pas.
      event.preventDefault();
      return;
    }
    const item = closestOf(event.target, "structure-link-formwork");
    if (!editable || !item?.draggable) return;
    drag = { zoneKey: item.dataset.zoneKey, number: item.dataset.number };
    // Sans donnée, certains navigateurs ne lancent pas le glisser.
    event.dataTransfer?.setData?.(DRAG_TYPE, drag.number);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "link";
    item.classList.add("is-dragging");
    elements.floors
      .filter((floor) => floor.dataset.zoneKey === drag.zoneKey)
      .forEach((floor) => floor.classList.add("is-droppable"));
  });

  // Accepter le survol (preventDefault) autorise le dépôt : seulement sur un étage de la zone.
  body.addEventListener("dragover", (event) => {
    const floor = dropFloorOf(event);
    setHover(floor);
    if (!floor) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
  });

  body.addEventListener("drop", (event) => {
    const floor = dropFloorOf(event);
    const dragged = drag;
    endDrag();
    if (!floor || !dragged) return;
    event.preventDefault();
    void link(floor.dataset.zoneKey, floor.dataset.floorKey, dragged.number);
  });

  body.addEventListener("dragend", () => endDrag());

  body.addEventListener("click", (event) => {
    const button = closestOf(event.target, "structure-link-action");
    const floor = button ? closestOf(button, "structure-link-floor") : null;
    if (busy || !editable || !floor) return;
    const { zoneKey, floorKey } = floor.dataset;
    if (button.dataset.action === "refresh") void refresh(zoneKey, floorKey);
    else if (button.dataset.action === "unlink") void unlink(zoneKey, floorKey);
  });

  closeButton?.addEventListener("click", close);
  // Fermeture par le bouton ou par Échap : la lecture en cours n'a plus où s'afficher.
  dialog.addEventListener("close", () => {
    loadToken += 1;
    data = null;
    endDrag();
  });

  return { open, close, closeIfStale };
}
