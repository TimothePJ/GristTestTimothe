// Sections repliées de chaque planning (numéros uniques des tâches), gardées dans le
// navigateur : chacun retrouve son propre affichage, rien n'est écrit dans Grist.
export const OUTLINE_STORAGE_KEY_PREFIX = "ms-project.collapsed-sections.";

// `storage` : localStorage, ou `null` s'il est inaccessible. Un stockage qui refuse la lecture
// ou l'écriture n'empêche pas de replier : l'état vit alors le temps de la session.
export function createOutlineStateStore(storage) {
  const collapsedByPlanning = new Map();

  function readStored(planningName) {
    try {
      const stored = JSON.parse(storage.getItem(OUTLINE_STORAGE_KEY_PREFIX + planningName));
      return Array.isArray(stored) ? stored.map(String) : [];
    } catch (error) {
      return [];
    }
  }

  function collapsedOf(planningName) {
    if (!collapsedByPlanning.has(planningName)) {
      collapsedByPlanning.set(planningName, new Set(readStored(planningName)));
    }
    return collapsedByPlanning.get(planningName);
  }

  return {
    getCollapsedIds(planningName) {
      return [...collapsedOf(planningName)];
    },

    toggle(planningName, taskId) {
      const collapsed = collapsedOf(planningName);
      const id = String(taskId);
      if (!collapsed.delete(id)) collapsed.add(id);

      try {
        storage.setItem(
          OUTLINE_STORAGE_KEY_PREFIX + planningName,
          JSON.stringify([...collapsed])
        );
      } catch (error) {
        console.warn("Sections repliées non enregistrées dans le navigateur :", error);
      }
    },
  };
}
