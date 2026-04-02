import {
  Children,
  createContext,
  isValidElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import {
  Actions,
  initState,
  layoutReducer,
  type LayoutAction,
  type LayoutModel,
  type LayoutState,
  type PersistedPanels,
} from "rutabega";

type LayoutContextValue = {
  state: LayoutState;
  dispatch: React.Dispatch<LayoutAction>;
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within <Layout>");
  }
  return context;
}

type LayoutPanelProps = {
  id: string;
  children: ReactNode;
};

export function LayoutPanel({ children }: LayoutPanelProps) {
  return <>{children}</>;
}

type LayoutProps = {
  model: LayoutModel;
  children: ReactNode;
  className?: string;
  persistenceKey?: string;
  initialPanels?: PersistedPanels;
};

type PersistedLayout = {
  panels: PersistedPanels;
};

type RailTab = {
  id: string;
  label: string;
  onExpand: () => void;
};

function Rail({
  tabs,
  orientation,
}: {
  tabs: RailTab[];
  orientation: "horizontal" | "vertical";
}) {
  const isHorizontal = orientation === "horizontal";

  return (
    <div
      className={cn(
        "relative flex shrink-0 border-border/70 bg-muted/40",
        isHorizontal ? "w-11 border-l" : "h-11 border-t",
      )}
      data-slot="layout-rail"
    >
      <div
        className={cn(
          "absolute z-10 flex gap-2 p-1.5",
          isHorizontal ? "inset-x-0 top-0 flex-col" : "inset-y-0 left-0",
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={`Show ${tab.label}`}
            onClick={tab.onExpand}
            className={cn(
              "rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent",
              isHorizontal && "min-h-20 [writing-mode:vertical-rl]",
            )}
          >
            <span className="block truncate">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Splitter({
  panelId,
  orientation,
  onResize,
  onReset,
  containerRef,
  totalWeight,
}: {
  panelId: string;
  orientation: "horizontal" | "vertical";
  onResize: (panelId: string, delta: number) => void;
  onReset: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  totalWeight: number;
}) {
  const startPos = useRef(0);
  const isHorizontal = orientation === "horizontal";

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      startPos.current = isHorizontal ? event.clientX : event.clientY;
    },
    [isHorizontal],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }

      const container = containerRef.current;
      if (!container) return;

      const currentPos = isHorizontal ? event.clientX : event.clientY;
      const pixelDelta = currentPos - startPos.current;
      startPos.current = currentPos;

      const containerSize = isHorizontal
        ? container.offsetWidth
        : container.offsetHeight;
      if (containerSize === 0) return;

      const weightDelta = (pixelDelta / containerSize) * totalWeight;
      if (weightDelta !== 0) {
        onResize(panelId, weightDelta);
      }
    },
    [containerRef, isHorizontal, onResize, panelId, totalWeight],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  return (
    <div
      className={cn(
        "group relative shrink-0 select-none",
        isHorizontal ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
      data-slot="layout-splitter"
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-border/80 transition-[width,height,background-color] group-hover:bg-foreground/25",
          isHorizontal
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:w-1"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2 group-hover:h-1",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute z-10 rounded-sm bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100",
          isHorizontal
            ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90",
        )}
      >
        <GripVertical className="size-3" />
      </div>
    </div>
  );
}

export function Layout({
  model,
  children,
  className,
  persistenceKey,
  initialPanels,
}: LayoutProps) {
  const [state, dispatch] = useReducer(
    layoutReducer,
    model,
    (initialModel) => initState(initialModel, initialPanels),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const initialWeightsRef = useRef(
    Object.fromEntries(model.panels.map((panel) => [panel.id, panel.weight])),
  );
  const isHorizontal = state.orientation === "horizontal";

  useEffect(() => {
    if (!persistenceKey) return;

    const payload: PersistedLayout = {
      panels: Object.fromEntries(
        state.panels.map((panel) => [
          panel.id,
          {
            weight: panel.weight,
            collapsed: panel.collapsed,
            preCollapseWeight: panel.preCollapseWeight,
          },
        ]),
      ),
    };

    try {
      localStorage.setItem(persistenceKey, JSON.stringify(payload));
    } catch {
      // Ignore persistence failure and continue in memory.
    }
  }, [persistenceKey, state.panels]);

  const childMap = useMemo(() => {
    const panelIds = new Set(model.panels.map((panel) => panel.id));
    const map = new Map<string, ReactNode>();
    Children.forEach(children, (child) => {
      if (isValidElement<LayoutPanelProps>(child) && panelIds.has(child.props.id)) {
        map.set(child.props.id, child.props.children);
      }
    });
    return map;
  }, [children, model.panels]);

  const totalWeight = state.panels
    .filter((panel) => !panel.collapsed)
    .reduce((sum, panel) => sum + panel.weight, 0);

  const handleResize = useCallback(
    (panelId: string, delta: number) => dispatch(Actions.resize(panelId, delta)),
    [],
  );

  const handleReset = useCallback(() => {
    dispatch(Actions.setSizes(initialWeightsRef.current));
  }, []);

  const items: Array<
    | { type: "splitter"; panelId: string }
    | { type: "panel"; panel: LayoutState["panels"][number] }
    | { type: "rail"; panels: LayoutState["panels"] }
  > = [];

  let previousVisiblePanelId: string | null = null;
  let collapsedRun: LayoutState["panels"] = [];

  const flushCollapsedRun = () => {
    if (collapsedRun.length === 0) return;
    items.push({ type: "rail", panels: collapsedRun });
    collapsedRun = [];
  };

  for (const panel of state.panels) {
    if (panel.collapsed) {
      collapsedRun.push(panel);
      continue;
    }

    flushCollapsedRun();

    if (previousVisiblePanelId) {
      items.push({ type: "splitter", panelId: previousVisiblePanelId });
    }

    items.push({ type: "panel", panel });
    previousVisiblePanelId = panel.id;
  }

  flushCollapsedRun();

  return (
    <LayoutContext.Provider value={{ state, dispatch }}>
      <div
        ref={containerRef}
        className={cn(
          "flex h-full min-h-0 w-full min-w-0 overflow-hidden",
          isHorizontal ? "flex-row" : "flex-col",
          className,
        )}
        data-slot="layout"
      >
        {items.map((item, index) => {
          if (item.type === "splitter") {
            return (
              <Splitter
                key={`splitter-${item.panelId}-${index}`}
                panelId={item.panelId}
                orientation={state.orientation}
                onResize={handleResize}
                onReset={handleReset}
                containerRef={containerRef}
                totalWeight={totalWeight}
              />
            );
          }

          if (item.type === "rail") {
            return (
              <Rail
                key={item.panels.map((panel) => panel.id).join("-")}
                tabs={item.panels.map((panel) => ({
                  id: panel.id,
                  label: panel.label,
                  onExpand: () => dispatch(Actions.expand(panel.id)),
                }))}
                orientation={state.orientation}
              />
            );
          }

          const panel = item.panel;

          return (
            <section
              key={panel.id}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              style={{
                flexGrow: panel.weight * 1000,
                flexShrink: 1,
                flexBasis: 0,
              }}
              data-slot="layout-panel"
            >
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 bg-background/92 px-3 backdrop-blur-sm">
                <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {panel.label}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Collapse ${panel.label}`}
                  onClick={() => dispatch(Actions.collapse(panel.id))}
                >
                  {isHorizontal ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronLeft className="size-3.5 rotate-90" />
                  )}
                </Button>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                {childMap.get(panel.id)}
              </div>
            </section>
          );
        })}
      </div>
    </LayoutContext.Provider>
  );
}
