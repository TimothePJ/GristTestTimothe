// DOM minimal pour tester les modules d'interface sous Node : arbre, classes, dataset,
// écouteurs, capture du pointeur, rectangles réglables, images d'animation à la main.
export class FakeElement {
  constructor(tag = "div", className = "") {
    this.tagName = String(tag).toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set(String(className).split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
    this.dataset = {};
    this.style = {};
    this.textContent = "";
    this.scrollTop = 0;
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    this.captures = new Set();
  }

  get className() {
    return [...this.classes].join(" ");
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener, options) {
    const capture = options === true || Boolean(options?.capture);
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ listener, capture });
  }

  removeEventListener(type, listener, options) {
    const capture = options === true || Boolean(options?.capture);
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener || entry.capture !== capture)
    );
  }

  closest(selector) {
    const name = selector.replace(/^\./, "");
    for (let node = this; node; node = node.parentNode) {
      if (node.classes?.has(name)) return node;
    }
    return null;
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  setPointerCapture(pointerId) {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
  }
}

// Évènement qui remonte de la cible jusqu'à la racine, comme dans le navigateur.
export function dispatch(target, type, init = {}) {
  const event = {
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...init,
  };
  for (let node = target; node; node = node.parentNode) {
    (node.listeners.get(type) || []).forEach((entry) => entry.listener(event));
  }
  return event;
}

// Document et fenêtre factices : createElement, élément racine, écouteurs, images
// d'animation lancées à la main.
export function createFakeEnvironment() {
  const doc = new FakeElement("#document");
  doc.createElement = (tag) => new FakeElement(tag);
  doc.documentElement = doc.appendChild(new FakeElement("html"));
  const frames = new Map();
  let nextFrame = 1;
  const win = {
    requestAnimationFrame(callback) {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  return {
    doc,
    win,
    frames,
    runFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
