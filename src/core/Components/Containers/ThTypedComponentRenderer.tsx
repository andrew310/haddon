"use client";

import React, { ReactNode } from "react";

export type ComponentMap<T extends string> = {
  [type in T]: React.ComponentType<any>;
}

export interface TypedComponentRendererProps<T extends string, K extends keyof ComponentMap<T>> {
  type: K;
  componentMap: ComponentMap<T>;
  props?: any;
  children?: ReactNode;
}

export const ThTypedComponentRenderer = <T extends string, K extends keyof ComponentMap<T>>({
  type,
  componentMap,
  props,
  children,
}: TypedComponentRendererProps<T, K>) => {
  const Component = componentMap[type];

  if (!Component) {
    throw new Error(`Unsupported type: ${type}`);
  }

  return React.createElement(Component, props, children);
};