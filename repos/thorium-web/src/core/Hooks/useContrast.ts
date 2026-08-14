"use client";

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export enum ThContrast {
  none = "no-preference",
  more = "more",
  less = "less",
  custom = "custom"
}

export const useContrast = (onChange?: (contrast: ThContrast) => void) => {
  const [contrast, setContrast] = useState(ThContrast.none);

  const prefersNoContrast = useMediaQuery(`(prefers-contrast: ${ ThContrast.none })`);
  const prefersLessContrast = useMediaQuery(`(prefers-contrast: ${ ThContrast.less })`);
  const prefersMoreContrast = useMediaQuery(`(prefers-contrast: ${ ThContrast.more })`);
  const prefersCustomContrast = useMediaQuery(`(prefers-contrast: ${ ThContrast.custom })`);

  useEffect(() => {
    let newContrast: ThContrast = ThContrast.none;
    if (prefersNoContrast) {
      newContrast = ThContrast.none;
    } else if (prefersLessContrast) {
      newContrast = ThContrast.less;
    } else if (prefersMoreContrast) {
      newContrast = ThContrast.more;
    } else if (prefersCustomContrast) {
      newContrast = ThContrast.custom;
    }
    setContrast(newContrast);
    onChange && onChange(newContrast);
  }, [onChange, prefersNoContrast, prefersLessContrast, prefersMoreContrast, prefersCustomContrast]);

  return contrast;
}