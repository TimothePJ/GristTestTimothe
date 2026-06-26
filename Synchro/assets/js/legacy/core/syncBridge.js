import {
  areViewportsEqual,
  createPlanningViewportSnapshot,
  normalizePlanningScope,
  normalizePlanningViewport,
  scopesOverlap,
} from "./contracts.js";

function normalizeAdapterSnapshot(rawSnapshot = {}) {
  return {
    scope: normalizePlanningScope(rawSnapshot.scope),
    viewport: normalizePlanningViewport(rawSnapshot.viewport),
  };
}

export function createPlanningViewportSyncBridge({
  appId,
  channel,
  adapter,
}) {
  if (!appId) {
    throw new Error("Le bridge de synchronisation attend un appId.");
  }

  if (!channel || typeof channel.publish !== "function" || typeof channel.subscribe !== "function") {
    throw new Error("Le bridge attend un channel compatible.");
  }

  if (
    !adapter ||
    typeof adapter.getSnapshot !== "function" ||
    typeof adapter.applySnapshot !== "function" ||
    typeof adapter.subscribe !== "function"
  ) {
    throw new Error("Le bridge attend un adaptateur compatible.");
  }

  let isApplyingRemoteSnapshot = false;

  function buildSnapshot(rawSnapshot) {
    const baseSnapshot =
      rawSnapshot && typeof rawSnapshot === "object"
        ? rawSnapshot
        : adapter.getSnapshot();

    const normalized = normalizeAdapterSnapshot(baseSnapshot);

    return createPlanningViewportSnapshot({
      appId,
      scope: normalized.scope,
      viewport: normalized.viewport,
    });
  }

  function publishCurrent(rawSnapshot) {
    const snapshot = buildSnapshot(rawSnapshot);
    channel.publish(snapshot);
    return snapshot;
  }

  function handleLocalChange(rawSnapshot) {
    if (isApplyingRemoteSnapshot) {
      return;
    }

    publishCurrent(rawSnapshot);
  }

  function handleRemoteChange(snapshot) {
    if (!snapshot || snapshot.appId === appId) {
      return;
    }

    const localSnapshot = buildSnapshot();

    if (!scopesOverlap(localSnapshot.scope, snapshot.scope)) {
      return;
    }

    if (areViewportsEqual(localSnapshot.viewport, snapshot.viewport)) {
      return;
    }

    isApplyingRemoteSnapshot = true;

    try {
      adapter.applySnapshot(snapshot);
    } finally {
      queueMicrotask(() => {
        isApplyingRemoteSnapshot = false;
      });
    }
  }

  const unsubscribeAdapter = adapter.subscribe(handleLocalChange);
  const unsubscribeChannel = channel.subscribe(handleRemoteChange);

  return {
    appId,
    publishCurrent,
    destroy() {
      unsubscribeAdapter();
      unsubscribeChannel();
    },
  };
}
