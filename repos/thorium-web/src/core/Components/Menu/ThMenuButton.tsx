"use client";

import MoreVertIcon from "./assets/icons/more_vert.svg";

import { ThActionButton, ThActionButtonProps } from "../Buttons/ThActionButton";

export const ThMenuButton = ({
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
          <MoreVertIcon aria-hidden="true" focusable="false" /> 
          { label }
          </> 
      }
    </ThActionButton>
  )
}