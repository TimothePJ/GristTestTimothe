export function createHubState() {
  return {
    overviewApi: null,
    planningApi: null,
    planningAxisApi: null,
    expensesApi: null,
    expensesChartApi: null,
    activeProjectKey: "",
    requestedProjectKey: "",
    projectSyncInProgress: false,
    viewportSyncInProgress: false,
    pendingViewportPayload: null,
    lastAppliedViewportLogicalSignature: "",
    sharedViewportState: null,
    expensesFramePresentationTimer: 0,
    expensesChartFramePresentationTimer: 0,
    lastExpensesVisibleWidthAdjustment: Number.NaN,
    lastExpensesReferenceVisibleWidth: Number.NaN,
    lastExpensesPixelAlignmentDelta: Number.NaN,
    expensesVisibleWidthAdjustmentRerenderPending: false,
    planningLayoutDebugRafId: 0,
    planningLayoutDebugCleanup: null,
    lastPlanningLayoutDebugSignature: "",
    planningFrameResizeState: null,
    planningFrameResizeRefreshRafId: 0,
    overviewFramePresentationTimer: 0,
    overviewFrameResizeCleanup: null,
    overviewFrameResizeDocument: null,
    overviewFrameAttachPromise: null,
    overviewFrameAttachAttempt: 0,
    overviewProjectSubscriptionCleanup: null,
    overviewProjectSubscriptionApi: null,
    expensesFrameAttachPromise: null,
    expensesFrameAttachAttempt: 0,
    expensesViewportSubscriptionApi: null,
    expensesChartFrameAttachPromise: null,
    expensesChartFrameAttachAttempt: 0,
    pendingPlanningLayoutDebugReasons: new Set(),
  };
}

export const state = createHubState();

export function getReferencePlanningApi() {
  return state.planningAxisApi || state.planningApi || null;
}
