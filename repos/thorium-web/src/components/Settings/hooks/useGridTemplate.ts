"use client";

import { useEffect, useState } from "react";

import debounce from "debounce";

export const useGridTemplate = (ref: React.RefObject<HTMLDivElement | null>, type: "columns" | "rows" = "columns") => {
  const [visibleColumns, setVisibleColumns] = useState<number | null>(null);

  const updateVisibleColumns = () => {
    if (!ref.current) return;
    const computedStyle = window.getComputedStyle(ref.current);
    const columns = computedStyle.getPropertyValue(`grid-template-${ type }`);
    const columnCount = columns.replace("0px", "").split(" ").length;
    setVisibleColumns(columnCount);
  };

  const debouncedUpdateVisibleColumns = debounce(updateVisibleColumns, 100);

  useEffect(() => {
    updateVisibleColumns();

    const resizeObserver = new ResizeObserver(debouncedUpdateVisibleColumns);
    if (ref.current) {
      resizeObserver.observe(ref.current);
    }

    return () => {
      resizeObserver.disconnect();
      debouncedUpdateVisibleColumns.clear();
    };
  });

  return visibleColumns;
};