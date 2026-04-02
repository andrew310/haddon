// ---- Types ----

export type PanelDef = {
  id: string;
  label: string;
  weight: number;
  minWeight?: number;
};

export type LayoutModel = {
  orientation: "horizontal" | "vertical";
  panels: PanelDef[];
};

export type PanelState = PanelDef & {
  collapsed: boolean;
  preCollapseWeight: number | null;
};

export type LayoutState = {
  orientation: "horizontal" | "vertical";
  panels: PanelState[];
};

export type PersistedPanels = Record<
  string,
  {
    weight?: number;
    collapsed?: boolean;
    preCollapseWeight?: number | null;
  }
>;

// ---- Actions ----

type ResizeAction = { type: "resize"; panelId: string; delta: number };
type CollapseAction = { type: "collapse"; panelId: string };
type ExpandAction = { type: "expand"; panelId: string };
type SetSizesAction = { type: "setSizes"; weights: Record<string, number> };
type HydrateAction = {
  type: "hydrate";
  panels: PersistedPanels;
};

export type LayoutAction =
  | ResizeAction
  | CollapseAction
  | ExpandAction
  | SetSizesAction
  | HydrateAction;

export const Actions = {
  resize: (panelId: string, delta: number): ResizeAction => ({
    type: "resize",
    panelId,
    delta,
  }),
  collapse: (panelId: string): CollapseAction => ({
    type: "collapse",
    panelId,
  }),
  expand: (panelId: string): ExpandAction => ({
    type: "expand",
    panelId,
  }),
  setSizes: (weights: Record<string, number>): SetSizesAction => ({
    type: "setSizes",
    weights,
  }),
  hydrate: (panels: HydrateAction["panels"]): HydrateAction => ({
    type: "hydrate",
    panels,
  }),
} as const;

function applyPersistedPanels(
  state: LayoutState,
  persistedPanels?: PersistedPanels,
): LayoutState {
  if (!persistedPanels) return state;

  return {
    ...state,
    panels: state.panels.map((panel) => {
      const persisted = persistedPanels[panel.id];
      if (!persisted) return panel;

      return {
        ...panel,
        weight: persisted.weight ?? panel.weight,
        collapsed: persisted.collapsed ?? panel.collapsed,
        preCollapseWeight:
          persisted.preCollapseWeight !== undefined
            ? persisted.preCollapseWeight
            : panel.preCollapseWeight,
      };
    }),
  };
}

export function initState(
  model: LayoutModel,
  persistedPanels?: PersistedPanels,
): LayoutState {
  return {
    ...applyPersistedPanels(
      {
        orientation: model.orientation,
        panels: model.panels.map((p) => ({
          ...p,
          collapsed: false,
          preCollapseWeight: null,
        })),
      },
      persistedPanels,
    ),
  };
}

export function layoutReducer(
  state: LayoutState,
  action: LayoutAction,
): LayoutState {
  switch (action.type) {
    case "resize": {
      const panels = [...state.panels];
      const idx = panels.findIndex((p) => p.id === action.panelId);
      if (idx === -1 || idx >= panels.length - 1) return state;

      const current = panels[idx];
      const next = panels[idx + 1];
      const minA = current.minWeight ?? 0;
      const minB = next.minWeight ?? 0;

      let delta = action.delta;
      if (current.weight + delta < minA) delta = minA - current.weight;
      if (next.weight - delta < minB) delta = next.weight - minB;

      panels[idx] = { ...current, weight: current.weight + delta };
      panels[idx + 1] = { ...next, weight: next.weight - delta };
      return { ...state, panels };
    }

    case "collapse": {
      const target = state.panels.find((p) => p.id === action.panelId);
      if (!target || target.collapsed) return state;

      const panels = state.panels.map((p) => {
        if (p.id !== action.panelId) return p;
        return { ...p, collapsed: true, preCollapseWeight: p.weight, weight: 0 };
      });

      const collapsedPanel = panels.find((p) => p.id === action.panelId);
      if (!collapsedPanel || collapsedPanel.preCollapseWeight === null) {
        return { ...state, panels };
      }
      const freed = collapsedPanel.preCollapseWeight;
      const open = panels.filter((p) => !p.collapsed);
      const openTotal = open.reduce((s, p) => s + p.weight, 0);

      if (openTotal === 0) return { ...state, panels };

      const redistributed = panels.map((p) => {
        if (p.collapsed) return p;
        return { ...p, weight: p.weight + (freed * p.weight) / openTotal };
      });
      return { ...state, panels: redistributed };
    }

    case "expand": {
      const target = state.panels.find((p) => p.id === action.panelId);
      if (!target || !target.collapsed || target.preCollapseWeight === null) {
        return state;
      }
      const restoreWeight = target.preCollapseWeight;

      const open = state.panels.filter((p) => !p.collapsed && p.id !== action.panelId);
      const openTotal = open.reduce((s, p) => s + p.weight, 0);

      const panels = state.panels.map((p) => {
        if (p.id === action.panelId) {
          return { ...p, collapsed: false, weight: restoreWeight, preCollapseWeight: null };
        }
        if (p.collapsed) return p;
        return { ...p, weight: p.weight - (restoreWeight * p.weight) / openTotal };
      });
      return { ...state, panels };
    }

    case "setSizes": {
      const panels = state.panels.map((p) => {
        if (action.weights[p.id] !== undefined) {
          return { ...p, weight: action.weights[p.id] };
        }
        return p;
      });
      return { ...state, panels };
    }

    case "hydrate": {
      return applyPersistedPanels(state, action.panels);
    }
  }
}
