"use client";

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export const useMonochrome = (onChange?: (isMonochrome: boolean) => void) => {
  const [isMonochrome, setMonochrome] = useState(false);

  const monochrome = useMediaQuery("(monochrome)");

  useEffect(() => {
    setMonochrome(monochrome);
    onChange && onChange(monochrome);
  }, [monochrome, onChange]);

  return isMonochrome;
}