"use client";

import Delete from "./assets/icons/delete.svg";

import { ThActionButton, ThActionButtonProps } from "./ThActionButton";

export const ThDeleteButton = ({
  label,
  ref,
  compounds,
  children,
  ...props
}: ThActionButtonProps) => {
  return (
    <ThActionButton
      ref={ ref }
      compounds={ compounds }
      { ...props }
    >
      { children 
        ? children 
        : <>
          <Delete aria-hidden="true" focusable="false" /> 
          { label }
          </> 
      }
    </ThActionButton>
  )
}