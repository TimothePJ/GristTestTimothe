import {
  DEFAULT_SYNC_EVENT_NAME,
  DEFAULT_SYNC_STORAGE_KEY,
  isPlanningViewportSnapshot,
} from "./contracts.js";

function parseSnapshot(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return isPlanningViewportSnapshot(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function createPlanningViewportStorageChannel(options = {}) {
  const storageKey = String(options.storageKey || DEFAULT_SYNC_STORAGE_KEY).trim();
  const eventName = String(options.eventName || DEFAULT_SYNC_EVENT_NAME).trim();
  const listeners = new Set();

  function emit(snapshot, meta = {}) {
    listeners.forEach((listener) => {
      listener(snapshot, meta);
    });
  }

  function handleStorage(event) {
    if (event.key !== storageKey) {
      return;
    }

    const snapshot = parseSnapshot(event.newValue);
    if (!snapshot) {
      return;
    }

    emit(snapshot, { source: "storage" });
  }

  function handleCustomEvent(event) {
    const snapshot = event.detail;
    if (!isPlanningViewportSnapshot(snapshot)) {
      return;
    }

    emit(snapshot, { source: "custom-event" });
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(eventName, handleCustomEvent);

  return {
    storageKey,
    eventName,
    publish(snapshot) {
      if (!isPlanningViewportSnapshot(snapshot)) {
        throw new Error("Impossible de publier un viewport invalide.");
      }

      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
      window.dispatchEvent(new CustomEvent(eventName, { detail: snapshot }));
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readLastMessage() {
      return parseSnapshot(window.localStorage.getItem(storageKey));
    },
    destroy() {
      listeners.clear();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(eventName, handleCustomEvent);
    },
  };
}
