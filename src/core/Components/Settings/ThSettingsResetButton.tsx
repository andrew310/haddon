"use client";

import Undo from "./assets/icons/undo.svg";

import { ThActionButton, ThActionButtonProps } from "../Buttons/ThActionButton";

export const ThSettingsResetButton = ({
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
          <Undo aria-hidden="true" focusable="false" /> 
          { label }
          </> 
      }
    </ThActionButton>
  )
}