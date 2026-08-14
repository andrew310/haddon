"use client";

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export const useReducedTransparency = (onChange?: (reducedTransparency: boolean) => void) => {
  const [reducedTransparency, setReducedTransparency] = useState(false);

  const prefersReducedTransparency = useMediaQuery("(prefers-reduced-transparency: reduce)");

  useEffect(() => {
    setReducedTransparency(prefersReducedTransparency);
    onChange && onChange(prefersReducedTransparency);
  }, [prefersReducedTransparency, onChange]);

  return reducedTransparency;
}