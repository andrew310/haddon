"use client";

import React from "react";

import { useGridTemplate } from "./useGridTemplate";

export interface useGridNavigationProps {
  containerRef: React.RefObject<HTMLDivElement | null>,
  items: React.RefObject<any[]>,
  currentValue: any,
  onChange: (value: any) => void,
  isRTL?: boolean,
  onEscape?: () => void,
  onFocus?: (value: string) => void
}

export const useGridNavigation = ({
  containerRef,
  items,
  currentValue,
  onChange,
  isRTL,
  onEscape,
  onFocus
}: useGridNavigationProps) => {
  const visibleColumns = useGridTemplate(containerRef, "columns");

  const onKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    const columns = visibleColumns || 1;
    if (columns <= 1 || !items.current?.length) return;

    // Handle both object items { value, label, icon } and primitive items
    const currentIdx = items.current.findIndex((val) => {
      if (typeof val === "object" && val !== null && "value" in val) {
        return val.value === currentValue;
      }
      return val === currentValue;
    });

    if (currentIdx === -1) return;

    let nextIdx: number | null = null;

    switch (e.code) {
      case "ArrowUp":
        e.preventDefault();
        nextIdx = currentIdx - columns;
        break;
      case "ArrowDown":
        e.preventDefault();
        nextIdx = currentIdx + columns;
        break;
      case "ArrowLeft":
        e.preventDefault();
        nextIdx = isRTL ? currentIdx + 1 : currentIdx - 1;
        break;
      case "ArrowRight":
        e.preventDefault();
        nextIdx = isRTL ? currentIdx - 1 : currentIdx + 1;
        break;
      case "Escape":
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      default:
        return;
    }

    if (nextIdx !== null && nextIdx >= 0 && nextIdx < items.current.length) {
      const nextItem = items.current[nextIdx];

      // Extract value from object items or use primitive directly
      const nextValue = (typeof nextItem === "object" && nextItem !== null && "value" in nextItem)
        ? nextItem.value
        : nextItem;

      onChange(nextValue);

      if (onFocus) {
        onFocus(nextValue);
      }
    }
  }, [visibleColumns, items, currentValue, onChange, isRTL, onEscape, onFocus]);

  return { onKeyDown };
};