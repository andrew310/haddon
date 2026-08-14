"use client";

import ArrowBackIcon from "../assets/icons/arrow_back.svg";
import ArrowForwardIcon from "../assets/icons/arrow_forward.svg";

import { ThLink, ThLinkIconProps } from "./ThLink";

export interface ThBackArrowProps extends ThLinkIconProps {
  direction?: "left" | "right";
}

export const ThBackArrow = ({
  ref,
  href,
  "aria-label": ariaLabel,
  direction,
  ...props
}: ThBackArrowProps) => {
  return (
    <ThLink 
      href={ href }
      ref={ ref }
      aria-label={ ariaLabel }
      { ...props }
    >
      { direction === "right"
        ? <ArrowForwardIcon aria-hidden="true" focusable="false" />
        : <ArrowBackIcon aria-hidden="true" focusable="false" />
      }
    </ThLink>
  );
};