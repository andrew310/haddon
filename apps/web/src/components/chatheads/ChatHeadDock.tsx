import { useEffect, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";

import {
  CHAT_HEAD_SIZE,
  CLICK_SLOP,
  headLeftInStrip,
  laneIndex,
  readingColumns,
  restTopForHighlight,
} from "#/lib/chat-head-layout";
import {
  INERTIA_END_SPEED,
  INERTIA_MIN_SPEED,
  isSettled,
  speed,
  stepInertia,
  stepSpring,
  type SpringState,
} from "#/lib/chat-head-spring";
import type { ChatThread } from "#/lib/chat-threads";
import { speakerAvatar } from "#/lib/chat-threads";

type Props = {
  threads: ChatThread[];
  lanes?: number;
};

const REST = { x: 0, y: 0 };

export function ChatHeadDock({ threads, lanes = 1 }: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<Record<string, { left: number; top: number }>>(
    {},
  );
  const [poses, setPoses] = useState<Record<string, SpringState>>({});
  const posesRef = useRef(poses);
  posesRef.current = poses;
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    lastX: number;
    lastY: number;
    lastT: number;
    moved: boolean;
  } | null>(null);
  const rafRef = useRef<number>(0);
  const coastingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const measure = () => {
      const dockRect = dock.getBoundingClientRect();
      const book = document.querySelector(".haddon-article");
      if (!(book instanceof HTMLElement)) {
        setAnchors({});
        return;
      }
      const bookRect = book.getBoundingClientRect();
      const scroller = book.closest(".haddon-web-reader");
      const strip =
        scroller instanceof HTMLElement
          ? parseFloat(getComputedStyle(scroller).paddingRight) || 80
          : 80;
      const columns = readingColumns(bookRect, lanes, strip);
      const next: Record<string, { left: number; top: number }> = {};
      for (const thread of threads) {
        const mark = document.querySelector(
          `[data-haddon-decoration-highlights="${CSS.escape(thread.id)}"]`,
        );
        if (!(mark instanceof HTMLElement)) continue;
        const markRect = mark.getBoundingClientRect();
        const top = restTopForHighlight(markRect, dockRect, dockRect);
        if (top == null) continue;
        const col = columns[laneIndex(markRect.left + markRect.width / 2, columns)];
        if (!col) continue;
        next[thread.id] = {
          left: headLeftInStrip(col.right, strip),
          top: dockRect.top + top,
        };
      }
      setAnchors(next);
    };

    measure();
    const article = document.querySelector(".haddon-article");
    const scroller =
      article?.closest(".overflow-y-auto") ??
      article?.closest(".overflow-auto") ??
      article?.parentElement;
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const pulse = window.setInterval(measure, 400);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.clearInterval(pulse);
    };
  }, [threads, lanes]);

  const stopSpring = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };

  const runSpring = () => {
    stopSpring();
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(1 / 30, (now - previous) / 1000);
      previous = now;
      const dragging = dragRef.current?.id;
      let moving = false;
      const next: Record<string, SpringState> = { ...posesRef.current };
      const coasting = coastingRef.current;
      for (const [id, state] of Object.entries(next)) {
        if (id === dragging) continue;
        const tossing = coasting.has(id) && speed(state) > INERTIA_END_SPEED;
        const stepped = tossing
          ? stepInertia(state, dt)
          : stepSpring(state, REST, dt);
        if (!tossing) coasting.delete(id);
        next[id] = stepped;
        if (tossing || !isSettled(stepped)) moving = true;
      }
      posesRef.current = next;
      setPoses(next);
      if (moving) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = 0;
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stopSpring(), []);

  const onPointerDown = (threadId: string, event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: threadId,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    const dt = Math.max(0.008, (now - drag.lastT) / 1000);
    const current = posesRef.current[drag.id] ?? {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
    const next = {
      x: current.x + dx,
      y: current.y + dy,
      vx: current.vx * 0.35 + (dx / dt) * 0.65,
      vy: current.vy * 0.35 + (dy / dt) * 0.65,
    };
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastT = now;
    if (Math.hypot(next.x, next.y) > CLICK_SLOP) drag.moved = true;
    posesRef.current = { ...posesRef.current, [drag.id]: next };
    setPoses(posesRef.current);
  };

  const onPointerUp = (threadId: string, event: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag?.moved) {
      const state = posesRef.current[threadId];
      if (state && speed(state) >= INERTIA_MIN_SPEED) {
        coastingRef.current.add(threadId);
      }
      runSpring();
      return;
    }
    setOpenId((current) => (current === threadId ? null : threadId));
  };

  return (
    <div
      ref={dockRef}
      className="pointer-events-none absolute inset-0 z-50 overflow-visible"
    >
      <FloatingPortal>
        {threads.map((thread, index) => {
          const anchor = anchors[thread.id];
          if (!anchor) return null;
          const pose = poses[thread.id] ?? { x: 0, y: 0, vx: 0, vy: 0 };
          const dragging = dragRef.current?.id === thread.id;
          return (
            <ChatHead
              key={thread.id}
              thread={thread}
              left={anchor.left + pose.x}
              top={anchor.top + pose.y}
              zIndex={dragging || thread.id === openId ? 40 : 30 + index}
              open={thread.id === openId}
              onOpenChange={(next) => setOpenId(next ? thread.id : null)}
              onPointerDown={(event) => onPointerDown(thread.id, event)}
              onPointerMove={onPointerMove}
              onPointerUp={(event) => onPointerUp(thread.id, event)}
            />
          );
        })}
      </FloatingPortal>
    </div>
  );
}

function ChatHead({
  thread,
  left,
  top,
  zIndex,
  open,
  onOpenChange,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  thread: ChatThread;
  left: number;
  top: number;
  zIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
}) {
  const avatar = speakerAvatar(thread.speaker);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    strategy: "fixed",
    placement: "left",
    middleware: [
      offset(10),
      flip({ fallbackPlacements: ["right", "top-end", "bottom-end"] }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableWidth, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(180, Math.min(288, availableWidth))}px`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    role,
  ]);

  return (
    <div
      className="pointer-events-auto fixed will-change-transform"
      style={{
        top,
        left,
        zIndex,
      }}
    >
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps({
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
        })}
        aria-label={`${avatar.label}: ${thread.quote.slice(0, 80)}`}
        aria-expanded={open}
        className={`touch-none overflow-hidden rounded-full border border-black/5 shadow-[0_1px_2px_rgba(15,15,15,0.06),0_6px_16px_rgba(15,15,15,0.08)] active:scale-105 dark:border-white/10 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_8px_20px_rgba(0,0,0,0.35)] ${
          open ? "ring-2 ring-primary/50" : ""
        }`}
        style={{ width: CHAT_HEAD_SIZE, height: CHAT_HEAD_SIZE }}
      >
        {avatar.src ? (
          <img src={avatar.src} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center bg-muted text-sm font-semibold">
            {avatar.label.slice(0, 1)}
          </span>
        )}
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[300] w-72 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {thread.speaker.kind === "commentator"
                ? thread.speaker.name
                : "Ask AI"}
            </p>
            <p className="mt-2 leading-5 italic text-muted-foreground">
              “{thread.quote}”
            </p>
            <p className="mt-3 leading-6">
              {thread.reply ?? "No reply yet. Ask AI on this highlight."}
            </p>
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
}
