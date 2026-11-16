// Faux docApi en mémoire : applique des « user actions » Grist (AddRecord, BulkAddRecord,
// UpdateRecord, BulkUpdateRecord, RemoveRecord, BulkRemoveRecord) sur des lignes gardées en
// mémoire, pour que la fenêtre « Paramètre » fasse tourner le vrai contrôleur des tâches sans
// jamais écrire dans Grist. Module pur : aucune dépendance au DOM ni à grist.
// Les lignes sont des objets simples avec un champ `id` (même forme que fetchContextRows).
// Un lot est appliqué sur une copie : s'il échoue, l'état et onChange restent intacts.

function cloneRow(row) {
  return { ...row };
}

function fail(message) {
  throw new Error(`memoryDocApi : ${message}`);
}

export function createMemoryDocApi({
  rows = [],
  table = "Planning_Projet",
  defaults = {},
  onChange = () => {},
} = {}) {
  let state = rows.map(cloneRow);
  // Plus grand id jamais vu : les ids ne sont jamais réutilisés, même après suppression.
  let maxId = state.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);

  function applyBatch(actions) {
    const work = state.map(cloneRow);
    let nextId = maxId;
    const retValues = [];

    const indexOf = (id) => {
      const index = work.findIndex((row) => row.id === id);
      if (index < 0) fail(`ligne ${id} introuvable`);
      return index;
    };
    const addRow = (fields) => {
      nextId += 1;
      work.push({ ...defaults, ...fields, id: nextId });
      return nextId;
    };

    for (const action of actions) {
      if (!Array.isArray(action)) fail("action invalide");
      const [type, tableId, ...args] = action;
      if (tableId !== table) fail(`table inconnue « ${tableId} »`);
      switch (type) {
        case "AddRecord": {
          retValues.push(addRow(args[1] || {}));
          break;
        }
        case "BulkAddRecord": {
          const ids = args[0] || [];
          const columns = args[1] || {};
          const created = ids.map((_, i) => {
            const fields = {};
            for (const [column, values] of Object.entries(columns)) fields[column] = values[i];
            return addRow(fields);
          });
          retValues.push(created);
          break;
        }
        case "UpdateRecord": {
          Object.assign(work[indexOf(args[0])], args[1] || {});
          retValues.push(null);
          break;
        }
        case "BulkUpdateRecord": {
          const ids = args[0] || [];
          const columns = args[1] || {};
          ids.forEach((id, i) => {
            const row = work[indexOf(id)];
            for (const [column, values] of Object.entries(columns)) row[column] = values[i];
          });
          retValues.push(null);
          break;
        }
        case "RemoveRecord": {
          work.splice(indexOf(args[0]), 1);
          retValues.push(null);
          break;
        }
        case "BulkRemoveRecord": {
          for (const id of args[0] || []) work.splice(indexOf(id), 1);
          retValues.push(null);
          break;
        }
        default:
          fail(`action inconnue « ${type} »`);
      }
    }
    return { work, nextId, retValues };
  }

  return {
    async applyUserActions(actions) {
      const { work, nextId, retValues } = applyBatch(actions || []);
      state = work;
      maxId = nextId;
      onChange();
      return { retValues };
    },
    getRows() {
      return state.map(cloneRow);
    },
  };
}
