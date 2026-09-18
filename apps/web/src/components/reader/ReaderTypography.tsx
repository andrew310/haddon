import { Popover } from '@base-ui/react/popover'
import { Button, buttonVariants } from '#/components/ui/button'
import { cn } from '#/lib/utils'
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
} from '../../../../demo/src/reader-prefs'

import '@fontsource-variable/literata'
import '@fontsource-variable/literata/wght-italic.css'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/400-italic.css'
import '@fontsource/opendyslexic/700.css'
import '@fontsource/opendyslexic/700-italic.css'

const FONT_LABELS: Record<ReaderFont, string> = {
  sans: 'Sans',
  serif: 'Serif',
  dyslexia: 'Dyslexia',
}

const THEME_LABELS: Record<ReaderTheme, string> = {
  light: 'Light',
  sepia: 'Sepia',
  dark: 'Dark',
}

type Props = {
  prefs: ReaderPrefsV1
  onChange: (prefs: ReaderPrefsV1) => void
}

export function ReaderTypography({ prefs, onChange }: Props) {
  const nudge = (key: SteppedPrefKey, delta: -1 | 1) => {
    onChange(nudgeSteppedPref(prefs, key, delta))
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          buttonVariants({ variant: 'outline', size: 'icon-sm' }),
          'font-semibold tracking-tight',
        )}
        aria-label="Reading typography"
        title="Typeface, size, and page theme"
      >
        Aa
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-[120]"
        >
          <Popover.Popup className="w-80 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg outline-none">
            <Popover.Title className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Typography
            </Popover.Title>

            <fieldset className="mt-3 min-w-0 border-0 p-0">
              <legend className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Typeface
              </legend>
              <div className="mt-2 flex rounded-md border border-border p-0.5">
                {READER_FONTS.map((font) => (
                  <Button
                    key={font}
                    type="button"
                    size="sm"
                    variant={prefs.font === font ? 'default' : 'ghost'}
                    className="flex-1"
                    aria-pressed={prefs.font === font}
                    onClick={() => onChange({ ...prefs, font })}
                    style={{
                      fontFamily:
                        font === 'serif'
                          ? '"Literata Variable", Palatino, serif'
                          : font === 'dyslexia'
                            ? 'OpenDyslexic, sans-serif'
                            : undefined,
                    }}
                  >
                    {FONT_LABELS[font]}
                  </Button>
                ))}
              </div>
            </fieldset>

            <Stepper
              label="Size"
              valueLabel={`${prefs.fontSize}px`}
              onDecrease={() => nudge('fontSize', -1)}
              onIncrease={() => nudge('fontSize', 1)}
              decreaseDisabled={isMinStep(prefs.fontSize, FONT_SIZE_STEPS)}
              increaseDisabled={isMaxStep(prefs.fontSize, FONT_SIZE_STEPS)}
            />
            <Stepper
              label="Line height"
              valueLabel={String(prefs.lineHeight)}
              onDecrease={() => nudge('lineHeight', -1)}
              onIncrease={() => nudge('lineHeight', 1)}
              decreaseDisabled={isMinStep(prefs.lineHeight, LINE_HEIGHT_STEPS)}
              increaseDisabled={isMaxStep(prefs.lineHeight, LINE_HEIGHT_STEPS)}
            />
            <Stepper
              label="Measure"
              valueLabel={`${prefs.measure}rem`}
              onDecrease={() => nudge('measure', -1)}
              onIncrease={() => nudge('measure', 1)}
              decreaseDisabled={isMinStep(prefs.measure, MEASURE_STEPS)}
              increaseDisabled={isMaxStep(prefs.measure, MEASURE_STEPS)}
            />

            <fieldset className="mt-3 min-w-0 border-0 p-0">
              <legend className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Page
              </legend>
              <div className="mt-2 flex rounded-md border border-border p-0.5">
                {READER_THEMES.map((theme) => (
                  <Button
                    key={theme}
                    type="button"
                    size="sm"
                    variant={prefs.theme === theme ? 'default' : 'ghost'}
                    className="flex-1"
                    aria-pressed={prefs.theme === theme}
                    onClick={() => onChange({ ...prefs, theme })}
                  >
                    {THEME_LABELS[theme]}
                  </Button>
                ))}
              </div>
            </fieldset>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Stepper({
  label,
  valueLabel,
  onDecrease,
  onIncrease,
  decreaseDisabled,
  increaseDisabled,
}: {
  label: string
  valueLabel: string
  onDecrease: () => void
  onIncrease: () => void
  decreaseDisabled: boolean
  increaseDisabled: boolean
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={decreaseDisabled}
          onClick={onDecrease}
        >
          −
        </Button>
        <span className="min-w-14 text-center tabular-nums text-sm">
          {valueLabel}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={increaseDisabled}
          onClick={onIncrease}
        >
          +
        </Button>
      </div>
    </div>
  )
}
