"use client";

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export const useReducedMotion = (onChange?: (reducedMotion: boolean) => void) => {
  const [reducedMotion, setReducedMotion] = useState(false);

  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    setReducedMotion(prefersReducedMotion);
    onChange && onChange(prefersReducedMotion);
  }, [prefersReducedMotion, onChange]);

  return reducedMotion;
}