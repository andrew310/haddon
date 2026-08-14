"use client";

import { createContext } from "react";
import { defaultPreferences } from "./defaultPreferences";
import { ThPreferences, DefaultKeys, CustomizableKeys } from "./preferences";

export interface PreferencesContextValue<K extends CustomizableKeys = DefaultKeys> {
  preferences: ThPreferences<K>;
  updatePreferences: (prefs: ThPreferences<K>) => void;
}

// Create a context with a default value that will be overridden
export const ThPreferencesContext = createContext<PreferencesContextValue<any> | null>(null);

// Keep the default export for backward compatibility
export const defaultPreferencesContextValue: PreferencesContextValue<DefaultKeys> = {
  preferences: defaultPreferences as ThPreferences<DefaultKeys>,
  updatePreferences: () => {
    throw new Error("updatePreferences must be used within a ThPreferencesProvider with an adapter");
  },
};