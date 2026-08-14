"use client";

import LibraryIcon from "./assets/icons/newsstand.svg";

import { ThLink, ThLinkIconProps } from "./ThLink";

export const ThLibrary = ({
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
      <LibraryIcon aria-hidden="true" focusable="false" />
    </ThLink>
  );
};