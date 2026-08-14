import { ThSettingsRangePlaceholder } from "@/preferences";

import { useI18n } from "@/i18n/useI18n";

export const usePlaceholder = (
  placeholder: ThSettingsRangePlaceholder | string | { key: string; fallback?: string } | undefined,
  range: [number, number],
  format?: "percent" | "number" | "multiplier"
): string | undefined => {
  const { t } = useI18n();

  if (!placeholder) {
    return undefined;
  }

  // Handle enum values
  if (placeholder === ThSettingsRangePlaceholder.none) {
    return undefined;
  }
  if (placeholder === ThSettingsRangePlaceholder.range) {
    switch (format) {
      case "percent":
        const minRange = range[0] * 100;
        const maxRange = range[1] * 100;
        const minPercent = minRange === 0 ? "0" : `${minRange}%`;
        const maxPercent = maxRange === 0 ? "0" : `${maxRange}%`;
        return `${ minPercent } - ${ maxPercent }`;
      case "multiplier":
        const minMultiplierRange = range[0];
        const maxMultiplierRange = range[1];
        const minMultiplier = minMultiplierRange === 0 ? "0" : `${minMultiplierRange}×`;
        const maxMultiplier = maxMultiplierRange === 0 ? "0" : `${maxMultiplierRange}×`;
        return `${ minMultiplier } - ${ maxMultiplier }`;
      case "number":
      default:
        return `${ range[0] } - ${ range[1] }`;
    }
  }

  // Handle i18n object
  if (typeof placeholder === "object" && "key" in placeholder) {
    const translatedPlaceholder = t(placeholder.key);
    return translatedPlaceholder !== placeholder.key ? translatedPlaceholder : placeholder.fallback;
  }

  // Handle string values (literal text, not translated)
  if (typeof placeholder === "string") {
    return placeholder;
  }

  return undefined;
};