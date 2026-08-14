"use client";

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export const useForcedColors = (onChange?: (forcedColors: boolean) => void) => {
  const [colors, setForcedColors] = useState(false);

  const forcedColors = useMediaQuery("(forced-colors: active)");

  useEffect(() => {
    setForcedColors(forcedColors);
    onChange && onChange(forcedColors);
  }, [forcedColors, onChange]);

  return colors;
}