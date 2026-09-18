export const READER_PREFS_SCHEMA = "haddon.prefs" as const;
export const READER_PREFS_VERSION = 1 as const;
export const READER_PREFS_KEY = "haddon:web:prefs";
export const READER_PREFS_EVENT = "haddon:web:prefs";

export const READER_FONTS = ["sans", "serif", "dyslexia"] as const;
export type ReaderFont = (typeof READER_FONTS)[number];

export const READER_THEMES = ["light", "sepia", "dark"] as const;
export type ReaderTheme = (typeof READER_THEMES)[number];

export const FONT_SIZE_STEPS = [16, 18, 20, 22, 24, 26, 28] as const;
export const LINE_HEIGHT_STEPS = [1.4, 1.5, 1.65, 1.8, 2] as const;
export const MEASURE_STEPS = [32, 38, 45, 52, 60] as const;

export type ReaderPrefsV1 = {
  schema: typeof READER_PREFS_SCHEMA;
  version: typeof READER_PREFS_VERSION;
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  measure: number;
  theme: ReaderTheme;
};

export const DEFAULT_READER_PREFS: ReaderPrefsV1 = {
  schema: READER_PREFS_SCHEMA,
  version: READER_PREFS_VERSION,
  font: "sans",
  fontSize: 18,
  lineHeight: 1.65,
  measure: 45,
  theme: "light",
};

export const READER_FONT_STACKS: Record<ReaderFont, string> = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  serif:
    '"Literata Variable", Literata, "Iowan Old Style", Palatino, "Palatino Linotype", serif',
  dyslexia: 'OpenDyslexic, "Comic Sans MS", "Comic Sans", sans-serif',
};

export const READER_THEME_COLORS: Record<
  ReaderTheme,
  { bg: string; text: string; muted: string; link: string }
> = {
  light: {
    bg: "#fbf7f0",
    text: "#1c1917",
    muted: "#57534e",
    link: "#1d4ed8",
  },
  sepia: {
    bg: "#f4ecd8",
    text: "#5b4636",
    muted: "#7c6553",
    link: "#8b3d1f",
  },
  dark: {
    bg: "#1c1916",
    text: "#e8e2d6",
    muted: "#a8a29e",
    link: "#93c5fd",
  },
};

const STEPS = {
  fontSize: FONT_SIZE_STEPS,
  lineHeight: LINE_HEIGHT_STEPS,
  measure: MEASURE_STEPS,
} as const;

export type SteppedPrefKey = keyof typeof STEPS;

export function defaultReaderPrefs(): ReaderPrefsV1 {
  return { ...DEFAULT_READER_PREFS };
}

export function clampToSteps(
  value: number,
  steps: readonly number[],
): number {
  if (!Number.isFinite(value) || steps.length === 0) {
    return steps[0] ?? DEFAULT_READER_PREFS.fontSize;
  }
  let best = steps[0]!;
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i]!;
    const dist = Math.abs(value - step);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

export function stepValue(
  value: number,
  steps: readonly number[],
  delta: -1 | 1,
): number {
  if (steps.length === 0) return value;
  const current = clampToSteps(value, steps);
  const index = steps.indexOf(current);
  const next = index + delta;
  if (next <= 0) return steps[0]!;
  if (next >= steps.length) return steps[steps.length - 1]!;
  return steps[next]!;
}

export function isMinStep(value: number, steps: readonly number[]): boolean {
  return steps.length === 0 || clampToSteps(value, steps) === steps[0];
}

export function isMaxStep(value: number, steps: readonly number[]): boolean {
  return (
    steps.length === 0 ||
    clampToSteps(value, steps) === steps[steps.length - 1]
  );
}

function isReaderFont(value: unknown): value is ReaderFont {
  return value === "sans" || value === "serif" || value === "dyslexia";
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return value === "light" || value === "sepia" || value === "dark";
}

export function normalizeReaderPrefs(
  input: Partial<ReaderPrefsV1> | Record<string, unknown> | null | undefined,
): ReaderPrefsV1 {
  const record = input && typeof input === "object" ? input : {};
  return {
    schema: READER_PREFS_SCHEMA,
    version: READER_PREFS_VERSION,
    font: isReaderFont(record.font) ? record.font : DEFAULT_READER_PREFS.font,
    fontSize: clampToSteps(
      typeof record.fontSize === "number"
        ? record.fontSize
        : DEFAULT_READER_PREFS.fontSize,
      FONT_SIZE_STEPS,
    ),
    lineHeight: clampToSteps(
      typeof record.lineHeight === "number"
        ? record.lineHeight
        : DEFAULT_READER_PREFS.lineHeight,
      LINE_HEIGHT_STEPS,
    ),
    measure: clampToSteps(
      typeof record.measure === "number"
        ? record.measure
        : DEFAULT_READER_PREFS.measure,
      MEASURE_STEPS,
    ),
    theme: isReaderTheme(record.theme)
      ? record.theme
      : DEFAULT_READER_PREFS.theme,
  };
}

export function parseReaderPrefs(raw: string | null): ReaderPrefsV1 {
  if (!raw) return defaultReaderPrefs();
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPrefsV1>;
    if (
      parsed.schema !== READER_PREFS_SCHEMA ||
      parsed.version !== READER_PREFS_VERSION
    ) {
      return defaultReaderPrefs();
    }
    return normalizeReaderPrefs(parsed);
  } catch {
    return defaultReaderPrefs();
  }
}

export function serializeReaderPrefs(prefs: ReaderPrefsV1): string {
  return JSON.stringify(normalizeReaderPrefs(prefs));
}

export function readerPrefsSignature(prefs: ReaderPrefsV1): string {
  const next = normalizeReaderPrefs(prefs);
  return `${next.font}|${next.fontSize}|${next.lineHeight}|${next.measure}|${next.theme}`;
}

export function readerPrefsCssVars(
  prefs: ReaderPrefsV1,
): Record<string, string> {
  const next = normalizeReaderPrefs(prefs);
  const theme = READER_THEME_COLORS[next.theme];
  return {
    "--haddon-font-family": READER_FONT_STACKS[next.font],
    "--haddon-font-size": `${next.fontSize}px`,
    "--haddon-line-height": String(next.lineHeight),
    "--haddon-measure": `${next.measure}rem`,
    "--haddon-page-bg": theme.bg,
    "--haddon-page-text": theme.text,
    "--haddon-page-muted": theme.muted,
    "--haddon-link": theme.link,
    "--haddon-text": theme.text,
    "--haddon-text-muted": theme.muted,
  };
}

/** Page fill only — do not put font vars on chrome. */
export function readerPaneCssVars(
  prefs: ReaderPrefsV1,
): Record<string, string> {
  const theme = READER_THEME_COLORS[normalizeReaderPrefs(prefs).theme];
  return {
    "--haddon-page-bg": theme.bg,
  };
}

export function nudgeSteppedPref(
  prefs: ReaderPrefsV1,
  key: SteppedPrefKey,
  delta: -1 | 1,
): ReaderPrefsV1 {
  return normalizeReaderPrefs({
    ...prefs,
    [key]: stepValue(prefs[key], STEPS[key], delta),
  });
}

export function loadReaderPrefs(
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): ReaderPrefsV1 {
  if (!storage) return defaultReaderPrefs();
  return parseReaderPrefs(storage.getItem(READER_PREFS_KEY));
}

export function saveReaderPrefs(
  prefs: ReaderPrefsV1,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): ReaderPrefsV1 {
  const next = normalizeReaderPrefs(prefs);
  if (storage) {
    storage.setItem(READER_PREFS_KEY, serializeReaderPrefs(next));
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ReaderPrefsV1>(READER_PREFS_EVENT, { detail: next }),
    );
  }
  return next;
}

export function subscribeReaderPrefs(
  listener: (prefs: ReaderPrefsV1) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onCustom = (event: Event) => {
    if (event instanceof CustomEvent) {
      listener(normalizeReaderPrefs(event.detail));
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === READER_PREFS_KEY) {
      listener(parseReaderPrefs(event.newValue));
    }
  };

  window.addEventListener(READER_PREFS_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(READER_PREFS_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
