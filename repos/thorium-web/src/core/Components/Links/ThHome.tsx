"use client";

import HomeIcon from "./assets/icons/home.svg";

import { ThLink, ThLinkIconProps } from "./ThLink";

export const ThHome = ({
  ref,
  href,
  "aria-label": ariaLabel,
  ...props
}: ThLinkIconProps) => {
  return (
    <ThLink 
      href={ href }
      ref={ ref }
      aria-label={ ariaLabel }
      { ...props }
    >
      <HomeIcon aria-hidden="true" focusable="false" />
    </ThLink>
  );
};