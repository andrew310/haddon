"use client";

import { useObjectRef } from "react-aria";
import { Toolbar, ToolbarProps } from "react-aria-components";

export enum ThActionsTriggerVariant {
  button = "iconButton",
  menu = "menuItem"
}

export interface ThActionEntry<T> {
  key: T;
  associatedKey?: string;
  Trigger: React.ComponentType<any>;
  Target?: React.ComponentType<any>;
}

export interface ThActionsBarProps extends ToolbarProps {
  ref?: React.ForwardedRef<HTMLDivElement>
};

export const ThActionsBar = ({ 
  ref, 
  children, 
  ...props 
}: ThActionsBarProps) => {
  const resolvedRef = useObjectRef(ref);

  return (
    <Toolbar 
      ref={ resolvedRef } 
      { ...props }
    >
      { children }
    </Toolbar>
  )
}