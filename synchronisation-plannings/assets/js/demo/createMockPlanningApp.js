import { normalizePlanningViewport } from "../core/contracts.js";
import {
  addDays,
  addMonths,
  addYears,
  formatDateLabel,
  getTodayIsoDate,
} from "../utils/date.js";

const PROJECT_OPTIONS = ["Test1455", "Test1634", "1628", "0957"];

function shiftAnchorDate(anchorDate, mode, direction) {
  if (mode === "week") {
    return addDays(anchorDate, direction * 7);
  }
  if (mode === "month") {
    return addMonths(anchorDate, direction);
  }
  if (mode === "year") {
    return addYears(anchorDate, direction);
  }
  return addDays(anchorDate, direction * 7);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createBadgeStyle(color) {
  return `background:${color};`;
}

export function createMockPlanningApp({
  container,
  title,
  subtitle,
  appId,
  accentColor,
  initialScope = {},
  initialViewport = {},
  showScopeControls = true,
}) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("Le conteneur de demo est introuvable.");
  }

  const subscribers = new Set();
  let lastSyncLabel = "Aucune synchro distante";
  let state = {
    scope: {
      projectId: String(initialScope.projectId || PROJECT_OPTIONS[0]).trim(),
      zoneId: String(initialScope.zoneId || "").trim(),
    },
    viewport: normalizePlanningViewport({
      anchorDate: getTodayIsoDate(),
      mode: "month",
      ...initialViewport,
    }),
  };

  function render() {
    const { scope, viewport } = state;
    const fillWidth = `${Math.max(12, Math.min(100, (viewport.visibleDays / 365) * 100))}%`;

    container.innerHTML = `
      <div class="mock-app" data-app-id="${escapeHtml(appId)}">
        <div class="mock-app-header">
          <div>
            <p class="eyebrow">Prototype app</p>
            <h2 class="mock-app-title">${escapeHtml(title)}</h2>
            <p class="mock-app-subtitle">${escapeHtml(subtitle)}</p>
            ${
              showScopeControls
                ? ""
                : `
            <p class="mock-app-context">
              Projet actif : <strong>${escapeHtml(scope.projectId || "-")}</strong>
            </p>
            `
            }
          </div>
          <span class="mock-app-badge" style="${createBadgeStyle(accentColor)}">
            ${escapeHtml(appId)}
          </span>
        </div>

        <div class="mock-form-grid">
          ${
            showScopeControls
              ? `
          <div class="mock-field">
            <label for="${escapeHtml(appId)}-project">Projet</label>
            <select id="${escapeHtml(appId)}-project" data-role="project-select">
              ${PROJECT_OPTIONS.map((projectId) => `
                <option value="${escapeHtml(projectId)}" ${
                  projectId === scope.projectId ? "selected" : ""
                }>
                  ${escapeHtml(projectId)}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="mock-field">
            <label for="${escapeHtml(appId)}-zone">Zone</label>
            <input
              id="${escapeHtml(appId)}-zone"
              data-role="zone-input"
              type="text"
              placeholder="Optionnel"
              value="${escapeHtml(scope.zoneId)}"
            />
          </div>
          `
              : ""
          }

          <div class="mock-field">
            <label for="${escapeHtml(appId)}-anchor">Date d'ancrage</label>
            <input
              id="${escapeHtml(appId)}-anchor"
              data-role="anchor-date-input"
              type="date"
              value="${escapeHtml(viewport.anchorDate)}"
            />
          </div>

          <div class="mock-field">
            <label for="${escapeHtml(appId)}-visible-days">Jours visibles</label>
            <input
              id="${escapeHtml(appId)}-visible-days"
              data-role="visible-days-input"
              type="number"
              min="1"
              step="1"
              value="${escapeHtml(String(viewport.visibleDays))}"
            />
          </div>
        </div>

        <div class="mock-toolbar">
          <div class="mock-mode-buttons">
            ${["week", "month", "year"].map((mode) => `
              <button
                type="button"
                class="mode-btn ${viewport.mode === mode ? "is-active" : ""}"
                style="${viewport.mode === mode ? createBadgeStyle(accentColor) : ""}"
                data-role="mode-btn"
                data-mode="${escapeHtml(mode)}"
              >
                ${escapeHtml(mode)}
              </button>
            `).join("")}
          </div>

          <div class="mock-nav-buttons">
            <button type="button" class="nav-btn" data-role="nav-btn" data-direction="-1">
              Precedent
            </button>
            <button type="button" class="today-btn" data-role="today-btn">
              Aujourd'hui
            </button>
            <button type="button" class="nav-btn" data-role="nav-btn" data-direction="1">
              Suivant
            </button>
          </div>
        </div>

        <div class="mock-status-grid">
          <div class="mock-stat">
            <span>Premier jour visible</span>
            <strong>${escapeHtml(viewport.firstVisibleDate)}</strong>
          </div>
          <div class="mock-stat">
            <span>Fin de fenetre</span>
            <strong>${escapeHtml(viewport.rangeEndDate)}</strong>
          </div>
          <div class="mock-stat">
            <span>Derniere sync</span>
            <strong>${escapeHtml(lastSyncLabel)}</strong>
          </div>
        </div>

        <div class="mock-range">
          <strong>
            ${escapeHtml(formatDateLabel(viewport.rangeStartDate))} -> ${escapeHtml(
              formatDateLabel(viewport.rangeEndDate)
            )}
          </strong>
          <div class="mock-range-bar">
            <div
              class="mock-range-fill"
              style="width:${fillWidth}; background:${escapeHtml(accentColor)};"
            ></div>
          </div>
          <div class="mock-range-labels">
            <span>${escapeHtml(viewport.rangeStartDate)}</span>
            <span>${escapeHtml(viewport.visibleDays)} jours visibles</span>
            <span>${escapeHtml(viewport.rangeEndDate)}</span>
          </div>
        </div>

        <div>
          <span class="mock-sync-pill ${lastSyncLabel === "Aucune synchro distante" ? "is-idle" : ""}">
            ${escapeHtml(lastSyncLabel)}
          </span>
        </div>
      </div>
    `;
  }

  function notifyLocalChange() {
    const snapshot = adapter.getSnapshot();
    subscribers.forEach((listener) => {
      listener(snapshot);
    });
  }

  function updateState(nextPartialState = {}, options = {}) {
    const nextScope = {
      ...state.scope,
      ...(nextPartialState.scope || {}),
    };

    const mergedViewport = {
      ...state.viewport,
      ...(nextPartialState.viewport || {}),
    };

    if (
      nextPartialState.viewport &&
      !Object.prototype.hasOwnProperty.call(nextPartialState.viewport, "firstVisibleDate")
    ) {
      delete mergedViewport.firstVisibleDate;
    }

    if (
      nextPartialState.viewport &&
      !Object.prototype.hasOwnProperty.call(nextPartialState.viewport, "rangeStartDate")
    ) {
      delete mergedViewport.rangeStartDate;
    }

    if (
      nextPartialState.viewport &&
      !Object.prototype.hasOwnProperty.call(nextPartialState.viewport, "rangeEndDate")
    ) {
      delete mergedViewport.rangeEndDate;
    }

    if (
      nextPartialState.viewport &&
      Object.prototype.hasOwnProperty.call(nextPartialState.viewport, "visibleDays") &&
      nextPartialState.viewport.visibleDays === undefined
    ) {
      delete mergedViewport.visibleDays;
    }

    state = {
      scope: {
        projectId: String(nextScope.projectId || "").trim(),
        zoneId: String(nextScope.zoneId || "").trim(),
      },
      viewport: normalizePlanningViewport(mergedViewport),
    };

    if (options.lastSyncLabel) {
      lastSyncLabel = options.lastSyncLabel;
    }

    render();

    if (options.notify !== false) {
      notifyLocalChange();
    }
  }

  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const modeBtn = target.closest('[data-role="mode-btn"]');
    if (modeBtn instanceof HTMLElement) {
      updateState({
        viewport: {
          mode: modeBtn.dataset.mode,
          visibleDays: undefined,
        },
      });
      return;
    }

    const navBtn = target.closest('[data-role="nav-btn"]');
    if (navBtn instanceof HTMLElement) {
      const direction = Number(navBtn.dataset.direction || 0);
      updateState({
        viewport: {
          anchorDate: shiftAnchorDate(state.viewport.anchorDate, state.viewport.mode, direction),
        },
      });
      return;
    }

    const todayBtn = target.closest('[data-role="today-btn"]');
    if (todayBtn instanceof HTMLElement) {
      updateState({
        viewport: {
          anchorDate: getTodayIsoDate(),
        },
      });
    }
  });

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-role="project-select"]')) {
      updateState({
        scope: {
          projectId: target.value,
        },
      });
      return;
    }

    if (target.matches('[data-role="zone-input"]')) {
      updateState({
        scope: {
          zoneId: target.value,
        },
      });
      return;
    }

    if (target.matches('[data-role="anchor-date-input"]')) {
      updateState({
        viewport: {
          anchorDate: target.value,
        },
      });
      return;
    }

    if (target.matches('[data-role="visible-days-input"]')) {
      updateState({
        viewport: {
          visibleDays: Number(target.value),
        },
      });
    }
  });

  const adapter = {
    getSnapshot() {
      return {
        scope: { ...state.scope },
        viewport: { ...state.viewport },
      };
    },

    setScope(nextScope = {}, options = {}) {
      updateState(
        {
          scope: nextScope,
        },
        {
          notify: options.notify !== false,
          lastSyncLabel: options.lastSyncLabel || lastSyncLabel,
        }
      );
    },

    setViewport(nextViewport = {}, options = {}) {
      updateState(
        {
          viewport: nextViewport,
        },
        {
          notify: options.notify !== false,
          lastSyncLabel: options.lastSyncLabel || lastSyncLabel,
        }
      );
    },

    applySnapshot(snapshot) {
      updateState(
        {
          scope: {
            projectId: snapshot.scope.projectId,
            zoneId: snapshot.scope.zoneId,
          },
          viewport: snapshot.viewport,
        },
        {
          notify: false,
          lastSyncLabel: `Recale depuis ${snapshot.appId}`,
        }
      );
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };

  render();
  return adapter;
}
