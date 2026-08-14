"use client";

import React from "react";

import ArrowBack from "../assets/icons/arrow_back.svg";
import ArrowForward from "../assets/icons/arrow_forward.svg";

import { ThActionButton, ThActionButtonProps } from "./ThActionButton";

export interface ThNavigationButtonProps extends ThActionButtonProps {
  direction?: "left" | "right";
}

export const ThNavigationButton = ({
  direction,
  label,
  ref,
  compounds,
  children,
  ...props
}: ThNavigationButtonProps) => {
  const fallBackChildren = (
    <React.Fragment>
      { direction === "right"
        ? <ArrowForward aria-hidden="true" focusable="false" />
        : <ArrowBack aria-hidden="true" focusable="false" />
      }
      { label }
    </React.Fragment>
  );

  return (
    <ThActionButton
      ref={ ref }
      compounds={ compounds }
      { ...props }
    >
      { children || fallBackChildren }
    </ThActionButton>
  )
}
