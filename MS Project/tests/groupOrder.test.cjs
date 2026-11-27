// Remise en ordre des lignes du planning sans tout détacher.
// vis-timeline, dès qu'une ligne est ajoutée ou retirée, détache toutes les lignes de la
// page puis les rattache une à une : replier 5 lignes en coûte 671. Le widget lui fait
// déplacer seulement les lignes qui ne sont pas à leur place.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", "assets", "js", "ui", "groupOrder.js")
).href;

async function install(timeline) {
  const { installInPlaceGroupOrdering } = await import(moduleUrl);
  return installInPlaceGroupOrdering(timeline);
}

// Élément de page réduit à ce que vis-timeline et le widget en utilisent. `moves` compte
// chaque rattachement : c'est lui qui coûte dans le navigateur.
class FakeNode {
  constructor(name, counter) {
    this.name = name;
    this.counter = counter;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  insertBefore(node, reference) {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("insertion refusée");
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    assert.notEqual(index, -1, "repère d'insertion absent du conteneur");
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    this.counter.moves += 1;
    return node;
  }
  appendChild(node) {
    return this.insertBefore(node, null);
  }
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
}

const ZONES = { label: "labelSet", foreground: "foreground", background: "background", axis: "axis" };

// Planning vis-timeline réduit à ce dont dépend l'ordre des lignes : les quatre zones de la
// page, une ligne (groupe) par numéro, et la méthode d'origine qui détache tout puis
// rattache tout.
function createTimeline(initialOrder) {
  const counter = { moves: 0, stockCalls: 0 };
  let order = [...initialOrder];
  const dom = {};
  Object.values(ZONES).forEach((zone) => { dom[zone] = new FakeNode(zone, counter); });
  // Comme dans vis-timeline : la zone des fonds commence par des éléments qui ne sont pas
  // des lignes.
  const strangers = [new FakeNode("fond général", counter), new FakeNode("hors groupe", counter)];
  strangers.forEach((node) => dom.background.appendChild(node));

  function createGroup(id) {
    const group = { id, dom: {} };
    Object.keys(ZONES).forEach((part) => { group.dom[part] = new FakeNode(`${part} ${id}`, counter); });
    group.show = () => {
      Object.entries(group.dom).forEach(([part, node]) => {
        if (!node.parentNode) dom[ZONES[part]].appendChild(node);
      });
    };
    group.hide = () => {
      Object.values(group.dom).forEach((node) => {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    };
    return group;
  }

  const itemSet = {
    dom,
    groups: {},
    groupIds: [],
    options: { groupOrder: "ordre" },
    groupsData: { getIds: () => [...order] },
    _orderNestedGroups: (ids) => ids,
    // Méthode d'origine de vis-timeline 8.5.6.
    _orderGroups() {
      counter.stockCalls += 1;
      const groupIds = this._orderNestedGroups(this.groupsData.getIds({ order: this.options.groupOrder }));
      const changed = groupIds.length !== this.groupIds.length || groupIds.some((id, index) => id !== this.groupIds[index]);
      if (changed) {
        groupIds.forEach((id) => this.groups[id].hide());
        groupIds.forEach((id) => this.groups[id].show());
        this.groupIds = groupIds;
      }
      return changed;
    },
  };
  initialOrder.forEach((id) => {
    itemSet.groups[id] = createGroup(id);
    itemSet.groups[id].show();
  });
  itemSet.groupIds = [...initialOrder];

  return {
    timeline: { itemSet },
    itemSet,
    counter,
    strangers,
    // Ce que vis-timeline fait quand des lignes arrivent : créées, puis rattachées en fin.
    addGroups(ids, nextOrder) {
      ids.forEach((id) => {
        itemSet.groups[id] = createGroup(id);
        itemSet.groups[id].show();
      });
      order = [...nextOrder];
    },
    // Ce que vis-timeline fait quand des lignes partent : détachées, puis ordre « à revoir ».
    removeGroups(ids) {
      ids.forEach((id) => {
        itemSet.groups[id].hide();
        delete itemSet.groups[id];
      });
      order = order.filter((id) => !ids.includes(id));
      itemSet.groupIds = [];
    },
    setOrder(nextOrder) {
      order = [...nextOrder];
    },
    // Numéros des lignes d'une zone, dans l'ordre de la page.
    shown(zone) {
      return dom[zone].childNodes
        .filter((node) => !strangers.includes(node))
        .map((node) => Number(node.name.split(" ").pop()));
    },
    // Tout le contenu de chaque zone, éléments qui ne sont pas des lignes compris.
    page() {
      return Object.fromEntries(
        Object.values(ZONES).map((zone) => [zone, dom[zone].childNodes.map((node) => node.name)])
      );
    },
    resetCounter() {
      counter.moves = 0;
      counter.stockCalls = 0;
    },
  };
}

function assertEveryZoneShows(planning, expectedOrder) {
  Object.values(ZONES).forEach((zone) => {
    assert.deepEqual(planning.shown(zone), expectedOrder, `zone ${zone}`);
  });
}

test("replier une section ne déplace aucune des lignes qui restent", async () => {
  const planning = createTimeline([1, 2, 3, 4, 5, 6]);
  assert.equal(await install(planning.timeline), true);
  planning.removeGroups([3, 4]);
  planning.resetCounter();

  const changed = planning.itemSet._orderGroups();

  assert.equal(changed, true);
  assert.equal(planning.counter.moves, 0);
  assert.equal(planning.counter.stockCalls, 0);
  assertEveryZoneShows(planning, [1, 2, 5, 6]);
  assert.deepEqual(planning.itemSet.groupIds, [1, 2, 5, 6]);
});

test("déplier une section ne déplace que ses lignes, à leur place", async () => {
  const planning = createTimeline([1, 2, 5, 6]);
  await install(planning.timeline);
  planning.addGroups([3, 4], [1, 2, 3, 4, 5, 6]);
  planning.resetCounter();

  const changed = planning.itemSet._orderGroups();

  assert.equal(changed, true);
  // 2 lignes × 4 zones.
  assert.equal(planning.counter.moves, 8);
  assert.equal(planning.counter.stockCalls, 0);
  assertEveryZoneShows(planning, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(planning.itemSet.groupIds, [1, 2, 3, 4, 5, 6]);
});

test("déplier la première ou la dernière section place ses lignes au bon bout", async () => {
  const planning = createTimeline([3, 4]);
  await install(planning.timeline);

  planning.addGroups([1, 2], [1, 2, 3, 4]);
  planning.itemSet._orderGroups();
  assertEveryZoneShows(planning, [1, 2, 3, 4]);

  planning.addGroups([5, 6], [1, 2, 3, 4, 5, 6]);
  planning.resetCounter();
  planning.itemSet._orderGroups();
  assertEveryZoneShows(planning, [1, 2, 3, 4, 5, 6]);
  // Déjà rattachées en fin de page par vis-timeline : rien à déplacer.
  assert.equal(planning.counter.moves, 0);
});

test("un ordre inchangé ne touche à rien", async () => {
  const planning = createTimeline([1, 2, 3]);
  await install(planning.timeline);
  planning.resetCounter();

  assert.equal(planning.itemSet._orderGroups(), false);
  assert.equal(planning.counter.moves, 0);
  assertEveryZoneShows(planning, [1, 2, 3]);
});

test("un changement de tri remet toutes les lignes dans le nouvel ordre", async () => {
  const planning = createTimeline([1, 2, 3, 4, 5]);
  await install(planning.timeline);
  planning.setOrder([4, 1, 5, 3, 2]);

  assert.equal(planning.itemSet._orderGroups(), true);

  assertEveryZoneShows(planning, [4, 1, 5, 3, 2]);
  assert.equal(planning.counter.stockCalls, 0);
});

test("une ligne détachée de la page y revient à sa place", async () => {
  const planning = createTimeline([1, 2, 3, 4]);
  await install(planning.timeline);
  planning.itemSet.groups[2].hide();
  planning.itemSet.groupIds = [];

  planning.itemSet._orderGroups();

  assertEveryZoneShows(planning, [1, 2, 3, 4]);
});

test("les éléments de vis-timeline placés avant les lignes restent devant", async () => {
  const planning = createTimeline([1, 2, 5, 6]);
  await install(planning.timeline);
  planning.addGroups([3, 4], [1, 2, 3, 4, 5, 6]);

  planning.itemSet._orderGroups();

  const background = planning.itemSet.dom.background.childNodes;
  assert.deepEqual(background.slice(0, 2), planning.strangers);
  assert.deepEqual(planning.shown("background"), [1, 2, 3, 4, 5, 6]);
});

// Le widget pose son quadrillage dans la zone des fonds, après les lignes déjà en place.
function addWidgetOverlay(planning) {
  const overlay = new FakeNode("quadrillage du widget", planning.counter);
  planning.itemSet.dom.background.appendChild(overlay);
  planning.strangers.push(overlay);
  return overlay;
}

test("un élément du widget posé après les lignes passe devant elles, sans tout détacher", async () => {
  const planning = createTimeline([1, 2, 3, 4]);
  await install(planning.timeline);
  const overlay = addWidgetOverlay(planning);
  planning.removeGroups([2]);
  planning.resetCounter();

  assert.equal(planning.itemSet._orderGroups(), true);

  assert.equal(planning.counter.stockCalls, 0);
  assert.equal(planning.counter.moves, 1);
  assert.deepEqual(planning.itemSet.dom.background.childNodes.slice(0, 3), [
    planning.strangers[0],
    planning.strangers[1],
    overlay,
  ]);
  assertEveryZoneShows(planning, [1, 3, 4]);
});

// Chaque suite de gestes doit laisser la page exactement comme le ferait vis-timeline seul.
const SCENARIOS = {
  "replier au milieu": (planning) => planning.removeGroups([3, 4]),
  "déplier au milieu": (planning) => {
    planning.removeGroups([3, 4]);
    planning.itemSet._orderGroups();
    planning.addGroups([3, 4], [1, 2, 3, 4, 5, 6]);
  },
  "déplier en tête et en queue": (planning) => {
    planning.removeGroups([1, 6]);
    planning.itemSet._orderGroups();
    planning.addGroups([1, 6], [1, 2, 3, 4, 5, 6]);
  },
  "changer de tri": (planning) => planning.setOrder([6, 2, 4, 1, 5, 3]),
  "tout remplacer": (planning) => {
    planning.removeGroups([1, 2, 3, 4, 5, 6]);
    planning.addGroups([7, 8, 9], [9, 7, 8]);
  },
  "quadrillage du widget puis repli": (planning) => {
    addWidgetOverlay(planning);
    planning.removeGroups([5]);
  },
  "quadrillage du widget puis dépli": (planning) => {
    planning.removeGroups([2, 3]);
    planning.itemSet._orderGroups();
    addWidgetOverlay(planning);
    planning.addGroups([2, 3], [1, 2, 3, 4, 5, 6]);
  },
};

for (const [name, play] of Object.entries(SCENARIOS)) {
  test(`même page que vis-timeline seul : ${name}`, async () => {
    const withWidget = createTimeline([1, 2, 3, 4, 5, 6]);
    await install(withWidget.timeline);
    const visAlone = createTimeline([1, 2, 3, 4, 5, 6]);

    for (const planning of [withWidget, visAlone]) {
      play(planning);
      planning.itemSet._orderGroups();
    }

    assert.deepEqual(withWidget.page(), visAlone.page());
    assert.deepEqual(withWidget.itemSet.groupIds, visAlone.itemSet.groupIds);
    assert.equal(withWidget.counter.stockCalls, 0);
  });
}

test("une ligne bâtie autrement que prévu : vis-timeline reprend sa méthode d'origine", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const planning = createTimeline([1, 2, 3]);
  await install(planning.timeline);
  // Comme une autre version de vis-timeline dont les lignes n'auraient pas de partie « axe ».
  Object.values(planning.itemSet.groups).forEach((group) => {
    group.dom.axis.parentNode.removeChild(group.dom.axis);
    delete group.dom.axis;
  });
  planning.setOrder([3, 1, 2]);
  planning.resetCounter();

  assert.equal(planning.itemSet._orderGroups(), true);

  assert.equal(planning.counter.stockCalls, 1);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(planning.shown("labelSet"), [3, 1, 2]);
  assert.deepEqual(planning.itemSet.groupIds, [3, 1, 2]);
});

test("une erreur pendant le rangement : vis-timeline reprend sa méthode d'origine, pour de bon", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const planning = createTimeline([1, 2, 5, 6]);
  await install(planning.timeline);
  planning.addGroups([3, 4], [1, 2, 3, 4, 5, 6]);
  planning.itemSet.dom.axis.failNextInsert = true;
  planning.resetCounter();

  assert.equal(planning.itemSet._orderGroups(), true);
  assert.equal(planning.counter.stockCalls, 1);
  assert.equal(warn.mock.callCount(), 1);
  assertEveryZoneShows(planning, [1, 2, 3, 4, 5, 6]);

  // Les rangements suivants passent directement par la méthode d'origine.
  planning.removeGroups([3]);
  planning.itemSet._orderGroups();
  assert.equal(planning.counter.stockCalls, 2);
  assert.equal(warn.mock.callCount(), 1);
  assertEveryZoneShows(planning, [1, 2, 4, 5, 6]);
});

test("une version de vis-timeline bâtie autrement est laissée telle quelle", async () => {
  assert.equal(await install(null), false);
  assert.equal(await install({}), false);

  const planning = createTimeline([1, 2, 3]);
  const stock = planning.itemSet._orderGroups;
  delete planning.itemSet._orderNestedGroups;
  assert.equal(await install(planning.timeline), false);
  assert.equal(planning.itemSet._orderGroups, stock);

  const other = createTimeline([1, 2, 3]);
  delete other.itemSet.dom.labelSet;
  assert.equal(await install(other.timeline), false);
});
