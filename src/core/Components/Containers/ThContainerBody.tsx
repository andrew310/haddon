"use client";

import { HTMLAttributesWithRef } from "../customTypes";

export interface ThContainerBodyProps extends HTMLAttributesWithRef<HTMLDivElement> {}

export const ThContainerBody = ({ 
  ref,
  children,
  ...props 
}: ThContainerBodyProps) => {
  return (
    <div 
      ref={ ref } 
      { ...props }
    >
      { children }
    </div>
  )
}