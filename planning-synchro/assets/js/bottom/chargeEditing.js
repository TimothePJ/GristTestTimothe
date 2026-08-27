// Interactions du plan de charge editable — mode Editer, clic-pour-creer/editer,
// suppression, ecritures TimeSegment. Porte/adapte de
// `gestion-depenses2/assets/js/ui/chargeTimeline.js`
// (getSlotIndexFromClientX, showChargePlanContextMenu,
// hideChargePlanContextMenu), de `gestion-depenses2/assets/js/main.js`
// (handleChargePlanEditModeToggle, handleChargePlanPointerDown,
// handleChargePlanContextMenu, handleChargePlanContextAction,
// openCreateChargePlanModal / openEditChargePlanModal,
// saveEditedChargePlanSegment, deleteChargePlanSegment) et de
// `gestion-depenses2/assets/js/utils/chargePlanSegmentForm.js`
// (resolveClickedMonthKey, resolveChargePlanClickIntent).
//
// MODELE « UN SEGMENT = UN MOIS » : un clic sur une piste vaut le mois entier.
// Il n'y a plus de glisser-creer, plus de poignees de redimensionnement et plus
// de controle de chevauchement — la cle metier (projet, personne, mois) est
// unique, donc un mois deja occupe s'EDITE au lieu de se doubler. Rien n'est
// ecrit dans Grist tant que la fenetre n'a pas ete validee.
//
// ADAPTATIONS vs la source :
// 1. Les creneaux viennent de l'accesseur `getVisibleSlots()` passe en option
//    (createChargeBoard().getVisibleSlots()) au lieu de la WeakMap interne
//    `activeVisibleSlotsByBoard` de la source.
// 2. Le DOM rendu ici clefe pistes et barres par `data-worker-name` (les
//    « workers » sont des lignes TimeSegment groupees par nom, sans id numerique
//    stable) et non par `data-worker-id` ; les editions/suppressions passent par
//    `segmentEl.dataset.segmentId`.
// 3. Pas de cache optimiste local : chaque ecriture est un CRUD suivi d'un
//    `await onChanged()` (re-fetch + re-render complet), au prix d'un aller-retour.
// 4. Pas de barre provisoire hachuree : la source la dessine dans son apercu de
//    selection, que ce portage n'utilise plus du tout.
// 5. `is-segment-editing-enabled`/`-locked` et le libelle du bouton sont
//    re-appliques apres chaque ecriture (`applyEditModeToDom()`), parce que
//    `onChanged()` declenche un `board.render()` qui remplace `boardEl.innerHTML`.
//    `editModeEnabled` vit dans la fermeture de ce module (amorce depuis la
//    classe du board a l'attache) et reste « collant » d'une ecriture a l'autre.
// 6. La fenetre `#ps-edit-segment-modal` (bottom/editSegmentModal.js) est un
//    frere de #ps-charge au niveau du body : elle survit donc au re-rendu du
//    board. Elle ne saisit que l'effectif ; le mois et la personne viennent du
//    clic et lui sont passes en lecture seule. Il n'y a plus de repli
//    `window.prompt` : la fenetre est le seul chemin d'edition.
//
// Module DOM/evenements : window/document/HTMLElement ne sont touches que dans
// les fermetures de `attachChargeEditing()` (jamais au niveau du module ni dans
// les fonctions pures exportees), si bien que `resolveClickedMonthKey` et
// `resolveSegmentClickIntent` s'importent et tournent sous Node — cf.
// tests/chargeSelection.test.mjs.

import { clamp } from "../utils/format.js";
import { monthKeyFromDate } from "../utils/monthSegments.js";
import { createTimeSegment, updateTimeSegment, removeTimeSegment } from "../services/gristService.js";
import { createEditSegmentModal } from "./editSegmentModal.js";

function cssEscapeValue(value) {
  const text = String(value);
  if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(text);
  }
  // Repli minimal pour ce qu'on emet (ids numeriques ou `s-N`, cles "YYYY-MM") :
  // on echappe guillemets et antislashs.
  return text.replace(/["\\]/g, "\\$&");
}

const EDIT_TOGGLE_SELECTOR = "[data-charge-plan-edit-toggle]";
const TRACK_SELECTOR = ".charge-plan-track";
const SEGMENT_BAR_SELECTOR = ".charge-plan-segment-bar";
const CONTEXT_MENU_SELECTOR = ".charge-plan-context-menu";
const CONTEXT_ACTION_SELECTOR = ".charge-plan-context-action";

// --- logique pure du geste (aucun DOM) ---------------------------------------

// Mois du creneau sous le curseur. `slots` a la forme de getVisibleSlots()
// ({ slotIndex, leftPx, widthPx, startAt: Date, endAt: Date, isWorkingDay }).
// Renvoie "" si l'index n'existe pas dans la liste.
export function resolveClickedMonthKey(slots, slotIndex) {
  const list = Array.isArray(slots) ? slots : [];
  const slot = list.find((candidate) => candidate?.slotIndex === Number(slotIndex));
  return slot ? monthKeyFromDate(slot.startAt) : "";
}

// Un id de segment n'est exploitable pour une ecriture que s'il correspond a une
// ligne Grist reelle : buildWorkersFromSegments retombe sur un id de synthese
// (`s-N`) quand la colonne id manque, et toReferenceId le rejetterait.
// Exporte parce que TOUS les chemins d'ecriture doivent passer par ce meme
// filtre : le clic gauche (via resolveSegmentClickIntent) comme le menu
// contextuel (Modifier ET Supprimer, via handleContextAction).
export function toEditableSegmentId(value) {
  if (value == null || value === "") return null;
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

// Que faire d'un clic sur une piste ? C'est ici que vit l'invariant « un segment
// = un mois » : un mois deja occupe s'edite, il ne se double jamais.
//
// `clickedSegmentId` = id de la barre REELLEMENT sous le curseur (null quand le
// clic tombe dans le vide du mois) ; `monthSegmentId` = id de la premiere barre
// du mois trouvee dans la piste. La barre cliquee PRIME : avec des doublons
// legacy que `assignSegmentLanes` empile en lanes 0 et 1, se fier au seul mois
// (querySelector rend le premier noeud du DOM) reviendrait a toujours editer
// celle du dessus, meme quand l'utilisateur a clique celle du dessous.
export function resolveSegmentClickIntent({
  monthKey,
  clickedSegmentId = null,
  monthSegmentId = null,
} = {}) {
  if (!monthKey) {
    return { action: "ignore" };
  }

  const clickedOnBar = clickedSegmentId != null && clickedSegmentId !== "";
  const rawSegmentId = clickedOnBar ? clickedSegmentId : monthSegmentId;
  const monthOccupied = rawSegmentId != null && rawSegmentId !== "";
  const segmentId = toEditableSegmentId(rawSegmentId);

  if (segmentId == null) {
    // Aucun id Grist exploitable : on ne cree que si le mois est vraiment libre,
    // sinon on ne devine pas quelle barre editer et un doublon violerait la cle.
    return monthOccupied ? { action: "ignore" } : { action: "create", monthKey };
  }

  return { action: "edit", segmentId };
}

// --- recherche de creneau (dependante du DOM, port de getSlotIndexFromClientX) --

function getSlotIndexAtClientX(trackEl, slots, clientX) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return -1;

  const trackRect = trackEl.getBoundingClientRect();
  const x = clamp(clientX - trackRect.left, 0, trackRect.width - 1);

  for (const slot of list) {
    const startX = slot.leftPx;
    const endX = slot.leftPx + slot.widthPx;
    if (x >= startX && x < endX) {
      return slot.slotIndex;
    }
  }

  return list[list.length - 1].slotIndex;
}

// --- menu contextuel (port de showChargePlanContextMenu / hide...) -----------

function hideContextMenu(boardEl) {
  const menuEl = boardEl?.querySelector(CONTEXT_MENU_SELECTOR);
  if (!(menuEl instanceof HTMLElement)) return;

  menuEl.hidden = true;
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  delete menuEl.dataset.segmentId;

  menuEl.querySelectorAll(CONTEXT_ACTION_SELECTOR).forEach((actionEl) => {
    delete actionEl.dataset.segmentId;
  });
}

function showContextMenu(boardEl, { clientX, clientY, segmentId }) {
  const menuEl = boardEl?.querySelector(CONTEXT_MENU_SELECTOR);
  if (!(menuEl instanceof HTMLElement)) return;

  menuEl.hidden = false;
  menuEl.dataset.segmentId = String(segmentId);
  menuEl.querySelectorAll(CONTEXT_ACTION_SELECTOR).forEach((actionEl) => {
    actionEl.dataset.segmentId = String(segmentId);
  });

  menuEl.style.left = `${clientX}px`;
  menuEl.style.top = `${clientY}px`;

  const margin = 8;
  const menuRect = menuEl.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
  menuEl.style.left = `${Math.min(clientX, maxLeft)}px`;
  menuEl.style.top = `${Math.min(clientY, maxTop)}px`;
}

// --- fabrique publique -------------------------------------------------------

// attachChargeEditing(boardEl, { getProjectNumber, getVisibleSlots, onChanged,
//   editSegmentModalEl, getAbsenceSet }) → { detach(), isEditModeEnabled() }
//
// Cable le bouton Editer, le clic-pour-creer/editer et le menu contextuel
// Modifier/Supprimer sur `boardEl`. Tous les ecouteurs sont delegues sur
// `boardEl`/document (jamais sur les elements internes), ils survivent donc au
// remplacement de `boardEl.innerHTML` par un `chargeBoard.render()` declenche
// depuis `onChanged()`.
export function attachChargeEditing(
  boardEl,
  { getProjectNumber, getVisibleSlots, onChanged, editSegmentModalEl, getAbsenceSet } = {}
) {
  if (!(boardEl instanceof HTMLElement)) {
    return { detach() {} };
  }

  let editModeEnabled = boardEl.classList.contains("is-segment-editing-enabled");

  // Fenetre de saisie (creation ET edition). Son element est un frere du board
  // au niveau du body : le re-rendu du board ne l'efface pas. `onSubmit` fait
  // l'ecriture Grist puis `onChanged()`.
  const editSegmentModal =
    editSegmentModalEl instanceof HTMLElement
      ? createEditSegmentModal(editSegmentModalEl, { onSubmit: handleEditSegmentSubmit })
      : null;

  function findSegmentBar(segmentId) {
    return boardEl.querySelector(
      `${SEGMENT_BAR_SELECTOR}[data-segment-id="${cssEscapeValue(segmentId)}"]`
    );
  }

  function resolveSlots() {
    const slots = typeof getVisibleSlots === "function" ? getVisibleSlots() : [];
    return Array.isArray(slots) ? slots : [];
  }

  function applyEditModeToDom() {
    boardEl.classList.toggle("is-segment-editing-enabled", editModeEnabled);
    boardEl.classList.toggle("is-segment-editing-locked", !editModeEnabled);
    boardEl.dataset.segmentEditMode = editModeEnabled ? "enabled" : "locked";

    const toggleEl = boardEl.querySelector(EDIT_TOGGLE_SELECTOR);
    if (toggleEl instanceof HTMLElement) {
      toggleEl.textContent = editModeEnabled ? "Verrouiller" : "Editer";
      toggleEl.classList.toggle("is-active", editModeEnabled);
      toggleEl.setAttribute("aria-pressed", editModeEnabled ? "true" : "false");
    }
  }

  // Execute une ecriture CRUD, rafraichit le board via onChanged(), puis
  // re-affirme le mode Editer (cf. adaptation 5) quoi qu'il arrive, pour que le
  // bouton ne retombe jamais silencieusement sur Verrouiller.
  async function persistWrite(writeFn) {
    try {
      await writeFn();
      if (typeof onChanged === "function") {
        await onChanged();
      }
    } catch (error) {
      console.error("Erreur ecriture TimeSegment (plan de charge) :", error);
    } finally {
      applyEditModeToDom();
    }
  }

  function handleToggleClick(event) {
    const target = event.target instanceof Element ? event.target.closest(EDIT_TOGGLE_SELECTOR) : null;
    if (!(target instanceof HTMLElement)) return;

    event.preventDefault();
    editModeEnabled = !editModeEnabled;
    applyEditModeToDom();
    if (!editModeEnabled) {
      hideContextMenu(boardEl);
    }
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(CONTEXT_MENU_SELECTOR)) return;

    hideContextMenu(boardEl);
    if (!editModeEnabled) return; // garde-fou : rien sans le mode Editer

    const trackEl = event.target.closest(TRACK_SELECTOR);
    if (!(trackEl instanceof HTMLElement)) return;

    const workerName = trackEl.dataset.workerName || "";
    if (!workerName) return;

    event.preventDefault();

    // Un clic vaut le mois entier. La barre sous le curseur, si elle existe, dit
    // elle-meme son mois : une barre etroite est elargie a 12px minimum au rendu
    // et peut deborder sur le mois voisin.
    const clickedBarEl = event.target.closest(SEGMENT_BAR_SELECTOR);
    const clickedBarMonthKey =
      clickedBarEl instanceof HTMLElement ? clickedBarEl.dataset.monthKey || "" : "";
    const slots = resolveSlots();
    const monthKey =
      clickedBarMonthKey ||
      resolveClickedMonthKey(slots, getSlotIndexAtClientX(trackEl, slots, event.clientX));
    if (!monthKey) return;

    // Repli pour un clic dans le vide : la premiere barre du mois dans la piste.
    const monthBarEl = trackEl.querySelector(
      `${SEGMENT_BAR_SELECTOR}[data-month-key="${cssEscapeValue(monthKey)}"]`
    );
    const intent = resolveSegmentClickIntent({
      monthKey,
      clickedSegmentId: clickedBarEl instanceof HTMLElement ? clickedBarEl.dataset.segmentId : null,
      monthSegmentId: monthBarEl instanceof HTMLElement ? monthBarEl.dataset.segmentId : null,
    });
    if (intent.action === "ignore") return;

    if (intent.action === "create") {
      openSegmentModal({ segmentId: null, monthKey, workerName, effectif: "" });
      return;
    }

    const targetBarEl = clickedBarEl instanceof HTMLElement ? clickedBarEl : monthBarEl;
    openSegmentModal({
      segmentId: intent.segmentId,
      monthKey,
      workerName,
      effectif: targetBarEl instanceof HTMLElement ? targetBarEl.dataset.effectif ?? "" : "",
    });
  }

  // Ouvre la fenetre en creation (segmentId null) ou en edition. Rien n'est
  // ecrit tant que l'utilisateur n'a pas valide.
  function openSegmentModal({ segmentId, monthKey, workerName, effectif }) {
    if (!editSegmentModal || !monthKey) return;
    editSegmentModal.open({
      segmentId,
      monthKey,
      workerName,
      effectif,
      absenceSet: typeof getAbsenceSet === "function" ? getAbsenceSet(workerName) : undefined,
    });
  }

  function handleContextMenuEvent(event) {
    if (!(event.target instanceof Element)) return;

    const segmentEl = event.target.closest(SEGMENT_BAR_SELECTOR);
    if (!(segmentEl instanceof HTMLElement)) {
      hideContextMenu(boardEl);
      return;
    }

    event.preventDefault();
    if (!editModeEnabled) {
      hideContextMenu(boardEl);
      return;
    }

    const segmentId = segmentEl.dataset.segmentId;
    if (!segmentId) {
      hideContextMenu(boardEl);
      return;
    }

    showContextMenu(boardEl, { clientX: event.clientX, clientY: event.clientY, segmentId });
  }

  // « Modifier » : meme fenetre que le clic, amorcee depuis la barre visee
  // (mois + effectif sur son dataset, personne sur la piste qui la porte).
  function handleModifySegment(segmentId) {
    const barEl = findSegmentBar(segmentId);
    if (!(barEl instanceof HTMLElement)) return;

    const trackEl = barEl.closest(TRACK_SELECTOR);
    openSegmentModal({
      segmentId,
      monthKey: barEl.dataset.monthKey || "",
      workerName: trackEl instanceof HTMLElement ? trackEl.dataset.workerName || "" : "",
      effectif: barEl.dataset.effectif ?? "",
    });
  }

  // Appele par la fenetre sur Enregistrer, avec un effectif deja valide.
  // Plus de controle de chevauchement : l'unicite (projet, personne, mois) le
  // remplace, et le clic sur un mois occupe edite au lieu de creer.
  async function handleEditSegmentSubmit({ segmentId, monthKey, workerName, selection }) {
    if (!editModeEnabled) {
      return { ok: false, error: "Cliquez sur Editer pour modifier le planning." };
    }

    let writeError = null;
    await persistWrite(async () => {
      try {
        if (segmentId == null) {
          await createTimeSegment({
            projectNumber: typeof getProjectNumber === "function" ? getProjectNumber() : undefined,
            name: workerName,
            monthKey,
            effectif: selection.effectifValueForSave,
          });
        } else {
          await updateTimeSegment({ segmentId, effectif: selection.effectifValueForSave });
        }
      } catch (error) {
        writeError = error;
        throw error;
      }
    });

    if (writeError) return { ok: false, error: "L'enregistrement du segment a echoue." };
    return { ok: true };
  }

  function handleContextAction(event) {
    if (!(event.target instanceof Element)) return;

    const actionEl = event.target.closest(CONTEXT_ACTION_SELECTOR);
    if (!(actionEl instanceof HTMLElement)) return;

    event.preventDefault();
    const menuEl = actionEl.closest(CONTEXT_MENU_SELECTOR);
    const rawSegmentId = actionEl.dataset.segmentId || menuEl?.dataset.segmentId;
    const action = actionEl.dataset.action || "";
    hideContextMenu(boardEl);

    if (!editModeEnabled) return;

    // Meme filtre que le clic gauche : un id de synthese (`s-N`, repli de
    // buildWorkersFromSegments quand la colonne id manque) ne designe aucune
    // ligne Grist. Sans ce garde, « Modifier » ouvrait quand meme la fenetre et
    // l'enregistrement finissait en throw avale par persistWrite, tandis que
    // « Supprimer » partait dans un removeTimeSegment sans effet.
    const segmentId = toEditableSegmentId(rawSegmentId);
    if (segmentId == null) return;

    if (action === "delete-segment") {
      void persistWrite(() => removeTimeSegment(segmentId));
      return;
    }

    if (action === "edit-segment") {
      handleModifySegment(segmentId);
    }
  }

  function handleDocumentClick(event) {
    if (!(event.target instanceof Element)) {
      hideContextMenu(boardEl);
      return;
    }
    if (event.target.closest(CONTEXT_MENU_SELECTOR)) return;
    hideContextMenu(boardEl);
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    hideContextMenu(boardEl);
  }

  boardEl.addEventListener("click", handleToggleClick);
  boardEl.addEventListener("pointerdown", handlePointerDown);
  boardEl.addEventListener("contextmenu", handleContextMenuEvent);
  boardEl.addEventListener("click", handleContextAction);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleKeyDown);

  applyEditModeToDom();

  function detach() {
    boardEl.removeEventListener("click", handleToggleClick);
    boardEl.removeEventListener("pointerdown", handlePointerDown);
    boardEl.removeEventListener("contextmenu", handleContextMenuEvent);
    boardEl.removeEventListener("click", handleContextAction);
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleKeyDown);
    if (editSegmentModal) editSegmentModal.destroy();
  }

  // Expose le mode Editer courant pour que le onChanged() de main.js re-rende le
  // board avec le BON editMode au lieu d'un false code en dur : le finally de
  // persistWrite le re-affirme synchroniquement apres une ecriture, mais un
  // chargeBoard.render()/setWindow() ulterieur (onChanged + rAF du controleur)
  // le remettrait sinon a « verrouille » via chargeBoard.lastEditMode. Une seule
  // source de verite.
  function isEditModeEnabled() {
    return editModeEnabled;
  }

  return { detach, isEditModeEnabled };
}
