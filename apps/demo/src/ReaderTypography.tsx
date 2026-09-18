import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/400-italic.css";
import "@fontsource/opendyslexic/700.css";
import "@fontsource/opendyslexic/700-italic.css";
import { useEffect, useId, useRef, useState } from "react";
import {
  FONT_SIZE_STEPS,
  LINE_HEIGHT_STEPS,
  MEASURE_STEPS,
  READER_FONTS,
  READER_THEMES,
  isMaxStep,
  isMinStep,
  nudgeSteppedPref,
  type ReaderFont,
  type ReaderPrefsV1,
  type ReaderTheme,
  type SteppedPrefKey,
} from "./reader-prefs";
import "./ReaderTypography.css";

const FONT_LABELS: Record<ReaderFont, string> = {
  sans: "Sans",
  serif: "Serif",
  dyslexia: "Dyslexia",
};

const THEME_LABELS: Record<ReaderTheme, string> = {
  light: "Light",
  sepia: "Sepia",
  dark: "Dark",
};

type Props = {
  prefs: ReaderPrefsV1;
  onChange: (prefs: ReaderPrefsV1) => void;
};

export function ReaderTypography({ prefs, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const nudge = (key: SteppedPrefKey, delta: -1 | 1) => {
    onChange(nudgeSteppedPref(prefs, key, delta));
  };

  return (
    <div className="haddon-typography" ref={rootRef}>
      <button
        type="button"
        className={open ? "active" : ""}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? titleId : undefined}
        aria-label="Reading typography"
        onClick={() => setOpen((value) => !value)}
      >
        Aa
      </button>
      {open ? (
        <div
          className="haddon-typography-popover"
          role="dialog"
          aria-labelledby={titleId}
        >
          <p className="haddon-typography-title" id={titleId}>
            Typography
          </p>

          <fieldset className="haddon-typography-fieldset">
            <legend>Typeface</legend>
            <div className="haddon-typography-segment">
              {READER_FONTS.map((font) => (
                <button
                  key={font}
                  type="button"
                  className={prefs.font === font ? "active" : ""}
                  aria-pressed={prefs.font === font}
                  data-font={font}
                  onClick={() => onChange({ ...prefs, font })}
                >
                  {FONT_LABELS[font]}
                </button>
              ))}
            </div>
          </fieldset>

          <Stepper
            label="Size"
            valueLabel={`${prefs.fontSize}px`}
            onDecrease={() => nudge("fontSize", -1)}
            onIncrease={() => nudge("fontSize", 1)}
            decreaseDisabled={isMinStep(prefs.fontSize, FONT_SIZE_STEPS)}
            increaseDisabled={isMaxStep(prefs.fontSize, FONT_SIZE_STEPS)}
          />
          <Stepper
            label="Line height"
            valueLabel={String(prefs.lineHeight)}
            onDecrease={() => nudge("lineHeight", -1)}
            onIncrease={() => nudge("lineHeight", 1)}
            decreaseDisabled={isMinStep(prefs.lineHeight, LINE_HEIGHT_STEPS)}
            increaseDisabled={isMaxStep(prefs.lineHeight, LINE_HEIGHT_STEPS)}
          />
          <Stepper
            label="Measure"
            valueLabel={`${prefs.measure}rem`}
            onDecrease={() => nudge("measure", -1)}
            onIncrease={() => nudge("measure", 1)}
            decreaseDisabled={isMinStep(prefs.measure, MEASURE_STEPS)}
            increaseDisabled={isMaxStep(prefs.measure, MEASURE_STEPS)}
          />

          <fieldset className="haddon-typography-fieldset">
            <legend>Page</legend>
            <div className="haddon-typography-segment">
              {READER_THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={prefs.theme === theme ? "active" : ""}
                  aria-pressed={prefs.theme === theme}
                  data-theme={theme}
                  onClick={() => onChange({ ...prefs, theme })}
                >
                  {THEME_LABELS[theme]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

function Stepper({
  label,
  valueLabel,
  onDecrease,
  onIncrease,
  decreaseDisabled,
  increaseDisabled,
}: {
  label: string;
  valueLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseDisabled: boolean;
  increaseDisabled: boolean;
}) {
  return (
    <div className="haddon-typography-stepper">
      <span className="haddon-typography-stepper-label">{label}</span>
      <div className="haddon-typography-stepper-controls">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={decreaseDisabled}
          onClick={onDecrease}
        >
          −
        </button>
        <span className="haddon-typography-stepper-value">{valueLabel}</span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={increaseDisabled}
          onClick={onIncrease}
        >
          +
        </button>
      </div>
    </div>
  );
}
