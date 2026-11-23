// optimisticRows.js — affichage immédiat d'une écriture en cours.
//
// Les lignes affichées prennent tout de suite les champs qui vont être écrits : l'écran
// bouge au geste, sans attendre l'écriture puis la relecture. Si l'écriture échoue, les
// lignes d'avant reviennent — une valeur jamais enregistrée ne doit pas rester à l'écran.
//
// Module pur : il ne connaît ni Grist ni le DOM, seulement les accès que l'appelant lui donne.

function applyFields(rows, fieldsByRowId, idCol) {
  let changed = false;
  const next = rows.map((row) => {
    const fields = fieldsByRowId.get(Number(row?.[idCol]));
    if (!fields) return row;
    changed = true;
    return { ...row, ...fields };
  });
  // Rien de visé : le tableau d'origine est rendu tel quel, pour qui compare par identité.
  return changed ? next : rows;
}

// `pendingRender` : rend la promesse du rechargement en cours, s'il y en a un.
export function createOptimisticRows({
  getRows,
  setRows,
  render,
  idCol = "id",
  pendingRender = () => null,
}) {
  return {
    // `fieldsByRowId` : Map(identifiant de ligne → champs écrits). Rend la fonction de
    // retour arrière, à appeler si l'écriture échoue.
    show(fieldsByRowId) {
      const previousRows = getRows();
      if (!Array.isArray(previousRows) || !(fieldsByRowId instanceof Map)) return () => {};

      const optimisticRows = applyFields(previousRows, fieldsByRowId, idCol);
      if (optimisticRows === previousRows) return () => {};

      setRows(optimisticRows);
      render();

      return () => {
        // Un rechargement parti avant l'échec a pu lire les lignes anticipées : il les
        // redessinerait en se terminant. Une fois fini, on redessine les lignes en place.
        const pending = pendingRender();
        if (pending) void Promise.resolve(pending).then(() => render());

        // Les lignes ont été relues dans Grist entre-temps : elles sont plus justes que la
        // photo d'avant, on n'y touche pas.
        if (getRows() !== optimisticRows) return;
        setRows(previousRows);
        render();
      };
    },
  };
}
