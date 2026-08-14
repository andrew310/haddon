"use client";

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export enum ThColorScheme {
  light = "light",
  dark = "dark"
}

export const useColorScheme = (onChange?: (colorScheme: ThColorScheme) => void) => {
  const [colorScheme, setColorScheme] = useState(ThColorScheme.light);
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");

  useEffect(() => {
    const scheme = prefersDarkMode ? ThColorScheme.dark : ThColorScheme.light;
    setColorScheme(scheme);
    onChange && onChange(scheme);
  }, [onChange, prefersDarkMode]);

  return colorScheme;
}