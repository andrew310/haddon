"use client";

import React from "react";
import { HTMLAttributesWithRef } from "./customTypes";

export interface ThGridProps<T> extends HTMLAttributesWithRef<HTMLUListElement> {
  items: T[];
  children?: never;
  renderItem: (item: T, index: number) => React.ReactNode;
  columnWidth?: number | string;
  gap?: number | string;
}

export const ThGrid = <T extends unknown>({
  ref,
  items,
  renderItem,
  columnWidth,
  gap,
  ...props
}: ThGridProps<T>) => {
  return (
    <ul 
      ref={ ref } 
      { ...props }
      style={{
        ...props.style,
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        boxSizing: "border-box",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${typeof columnWidth === "string" ? columnWidth : columnWidth + "px"}), 1fr))`,
        gap: typeof gap === "string" ? gap : gap + "px"
      }}
    >
      { items.map((item, index) => (
        <li key={ index }>
          { renderItem(item, index) }
        </li>
      )) }
    </ul>
  );
};