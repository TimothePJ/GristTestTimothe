export function createHubState() {
  return {
    planningApi: null,
    planningAxisApi: null,
    expensesApi: null,
    activeProjectKey: "",
    requestedProjectKey: "",
    projectSyncInProgress: false,
    sharedToolbarActionInProgress: false,
    planningVisualAggregateMode: false,
    viewportSyncInProgress: false,
    pendingViewportPayload: null,
    lastAppliedViewportLogicalSignature: "",
    sharedViewportState: null,
    expensesFramePresentationTimer: 0,
    lastExpensesVisibleWidthAdjustment: Number.NaN,
    lastExpensesReferenceVisibleWidth: Number.NaN,
    lastExpensesReferenceDayWidth: Number.NaN,
    lastExpensesPixelAlignmentDelta: Number.NaN,
    expensesVisibleWidthAdjustmentRerenderPending: false,
    planningLayoutDebugRafId: 0,
    planningLayoutDebugCleanup: null,
    lastPlanningLayoutDebugSignature: "",
    planningFrameResizeState: null,
    planningFrameResizeRefreshRafId: 0,
    planningFramePresentationTimer: 0,
    lastPlanningScrollbarShift: Number.NaN,
    expensesFrameAttachPromise: null,
    expensesFrameAttachAttempt: 0,
    expensesViewportSubscriptionApi: null,
    pendingPlanningLayoutDebugReasons: new Set(),
  };
}

export const state = createHubState();

export function getReferencePlanningApi() {
  return state.planningAxisApi || state.planningApi || null;
}
