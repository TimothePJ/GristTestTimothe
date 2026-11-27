// Dépli d'une grosse section en deux temps.
//
// Ajouter une ligne au planning a un coût fixe dans vis-timeline (création de la ligne, de
// sa barre, mesure de la barre) : quelques dizaines de lignes passent inaperçues, plusieurs
// centaines figent la page près d'une seconde avant que quoi que ce soit n'apparaisse.
// Au-delà d'un seuil, le widget affiche donc d'abord les premières lignes de la section —
// de quoi remplir l'écran, sous la flèche qui vient d'être cliquée — puis ajoute le reste
// juste après, pendant que ces premières lignes sont déjà visibles.

// Nombre de lignes nouvelles au-delà duquel le dépli se fait en deux temps.
export const UNFOLD_STAGING_THRESHOLD = 150;
// Lignes nouvelles affichées au premier temps : plus qu'un écran n'en montre (40 px l'une).
export const UNFOLD_FIRST_ROWS = 40;

// Données du premier temps : tout ce qui est déjà à l'écran (`displayedGroupIds`), plus les
// premières lignes nouvelles, chacune avec sa barre. `null` si le planning peut s'afficher
// d'un coup. Le planning complet n'est pas modifié : c'est lui qui sert au second temps.
export function planFirstUnfoldStage(
  timelineData,
  displayedGroupIds,
  { threshold = UNFOLD_STAGING_THRESHOLD, firstRows = UNFOLD_FIRST_ROWS } = {}
) {
  const groups = timelineData?.groups || [];
  const newGroups = groups.filter((group) => !displayedGroupIds.has(group.id));
  if (newGroups.length <= threshold) return null;

  const postponed = new Set(newGroups.slice(firstRows).map((group) => group.id));
  return {
    ...timelineData,
    groups: groups.filter((group) => !postponed.has(group.id)),
    items: (timelineData.items || []).filter((item) => !postponed.has(item.group)),
  };
}

// Enchaîne les deux temps. `schedule(callback)` doit rappeler une fois le premier temps
// affiché. Tout autre affichage du planning survenu entre-temps appelle `cancel()` : le
// reste, devenu périmé, ne part pas.
export function createTwoStageRunner(schedule) {
  let generation = 0;

  return {
    cancel() {
      generation += 1;
    },
    run(first, rest) {
      first();
      generation += 1;
      const mine = generation;
      schedule(() => {
        if (mine === generation) rest();
      });
    },
  };
}
