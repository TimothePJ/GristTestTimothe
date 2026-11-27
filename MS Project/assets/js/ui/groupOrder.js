// Ordre des lignes du planning dans la page.
//
// vis-timeline range ses lignes (ses « groupes ») ainsi : dès que la liste change, il détache
// toutes les lignes de la page puis les rattache une à une dans l'ordre. Replier une section
// de 5 lignes fait donc détacher et rattacher les 671 lignes du planning, que le navigateur
// doit ensuite toutes recalculer : c'est ce qui rendait le clic sur une flèche lent, et
// d'autant plus lent que le planning est long.
//
// Ici la méthode de rangement de notre planning est remplacée par une autre qui arrive au
// même ordre final en ne déplaçant que les lignes mal placées : aucune quand on replie,
// celles de la section quand on déplie.
//
// Cela s'appuie sur des pièces internes de vis-timeline (8.5.6). Si une autre version est
// bâtie autrement, ou au moindre imprévu, la méthode d'origine reprend la main.

// Partie d'une ligne → zone de la page qui la contient.
const ZONE_BY_PART = {
  label: "labelSet",
  foreground: "foreground",
  background: "background",
  axis: "axis",
};

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// Éléments d'une zone, dans l'ordre voulu. `null` si une ligne n'a pas la forme attendue.
function collectZoneElements(itemSet, groupIds, part) {
  const elements = [];
  for (const id of groupIds) {
    const element = itemSet.groups[id]?.dom?.[part];
    if (!element) return null;
    elements.push(element);
  }
  return elements;
}

// Première ligne présente dans la zone, et les éléments qui ne sont pas des lignes mais se
// trouvent après elle (le quadrillage que le widget ajoute dans la zone des fonds, par
// exemple). Les éléments placés avant les lignes n'ont pas à bouger.
function scanZone(container, rows) {
  let firstRow = null;
  const strangersAmongRows = [];
  for (let node = container.firstChild; node; node = node.nextSibling) {
    if (rows.has(node)) {
      firstRow = firstRow || node;
    } else if (firstRow) {
      strangersAmongRows.push(node);
    }
  }
  return { firstRow, strangersAmongRows };
}

// Met les lignes d'une zone dans l'ordre voulu, pour arriver à la même page que la méthode
// d'origine : d'abord ce qui n'est pas une ligne, puis les lignes dans l'ordre. Une ligne
// déjà à sa place n'est pas touchée ; une autre est insérée devant la suivante.
function placeInOrder(container, elements) {
  const { firstRow, strangersAmongRows } = scanZone(container, new Set(elements));
  strangersAmongRows.forEach((stranger) => container.insertBefore(stranger, firstRow));

  let next = firstRow;
  for (const element of elements) {
    if (element === next) {
      next = next.nextSibling;
    } else {
      container.insertBefore(element, next);
    }
  }
}

// Remplace, sur ce planning seulement, le rangement des lignes de vis-timeline.
// Renvoie `false` sans rien modifier si vis-timeline n'a pas la forme attendue.
export function installInPlaceGroupOrdering(timeline) {
  const itemSet = timeline?.itemSet;
  const stockOrderGroups = itemSet?._orderGroups;
  const hasExpectedShape =
    typeof stockOrderGroups === "function" &&
    typeof itemSet._orderNestedGroups === "function" &&
    Array.isArray(itemSet.groupIds) &&
    itemSet.groups &&
    Object.values(ZONE_BY_PART).every((zone) => typeof itemSet.dom?.[zone]?.insertBefore === "function");
  if (!hasExpectedShape) return false;

  function giveBackToVis(reason) {
    console.warn("Rangement des lignes rendu à vis-timeline :", reason);
    itemSet._orderGroups = stockOrderGroups;
    return stockOrderGroups.call(itemSet);
  }

  itemSet._orderGroups = function orderGroupsInPlace() {
    if (!this.groupsData) return false;

    try {
      const groupIds = this._orderNestedGroups(
        this.groupsData.getIds({ order: this.options.groupOrder })
      );
      if (sameIds(groupIds, this.groupIds)) return false;

      // Tout est vérifié avant le premier déplacement.
      const zones = [];
      for (const [part, zone] of Object.entries(ZONE_BY_PART)) {
        const elements = collectZoneElements(this, groupIds, part);
        if (!elements) return giveBackToVis(`ligne sans élément « ${part} »`);
        zones.push({ container: this.dom[zone], elements });
      }

      zones.forEach(({ container, elements }) => placeInOrder(container, elements));
      this.groupIds = groupIds;
      return true;
    } catch (error) {
      return giveBackToVis(error);
    }
  };

  return true;
}
