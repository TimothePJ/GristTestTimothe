// Pure height/clamp math for the top pane's resizable visible area.
// No DOM/window access: unit-testable under `node --test`.
//
// The top (vis-timeline) pane shows a bounded number of task rows. A splitter
// lets the user pick how many rows are visible, clamped to [minRows, maxRows]
// (5..16 per the brief). The computed height is handed to vis-timeline's
// `maxHeight` option: vis renders min(content, cap), so a project with fewer
// tasks than the window shows at its real content height (no blank rows), while
// a project with more tasks scrolls internally with the time axis kept sticky.
//
// `desiredRows` is kept in fractional ROW units (not pixels) on purpose: the
// axis band height changes with the zoom mode (week/month/year), so storing a
// pixel height would drift; rows are stable across zoom.

export function clampRows(rows, { minRows, maxRows }) {
  return Math.min(Math.max(rows, minRows), maxRows);
}

// axisHeightPx : measured height of the fixed time-axis band (#ps-planning .vis-panel.vis-top)
// rowHeightPx  : measured per-row height (a rendered single-line group label)
// groupCount   : number of task rows currently rendered
// desiredRows  : user-chosen visible-rows target (may be fractional, mid-drag)
export function computeTopPaneHeight({
  axisHeightPx,
  rowHeightPx,
  groupCount,
  desiredRows,
  minRows,
  maxRows,
}) {
  const clampedRows = clampRows(desiredRows, { minRows, maxRows });
  const rows = Math.max(groupCount || 0, 0);
  const effectiveRows = Math.min(clampedRows, rows);
  // Cap handed to vis (maxHeight): axis band + the clamped visible-rows window.
  const maxHeightPx = axisHeightPx + clampedRows * rowHeightPx;
  // What vis will actually render to (min of content and the cap).
  const contentHeightPx = axisHeightPx + rows * rowHeightPx;
  // Internal scroll only when there are more rows than the chosen window.
  const scrolls = rows > clampedRows;
  return { maxHeightPx, contentHeightPx, effectiveRows, clampedRows, scrolls };
}
