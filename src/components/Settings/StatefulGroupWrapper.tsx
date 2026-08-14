"use client";

import readerSharedUI from "../assets/styles/thorium-web.button.module.css";
import settingsStyles from "./assets/styles/thorium-web.reader.settings.module.css";

import { WithRef } from "@/core/Components/customTypes";

import { ThSettingsGroupPref, ThSpacingSettingsKeys, ThTextSettingsKeys } from "@/preferences";
import { PressEvent } from "react-aria";

import { SettingComponent } from "@/components/Plugins/PluginRegistry";

import { ThSettingsWrapper } from "@/core/Components/Settings/ThSettingsWrapper";
import { Heading, HeadingProps } from "react-aria-components";
import { usePreferences } from "@/preferences/hooks/usePreferences";

import classNames from "classnames";

export interface StatefulGroupWrapperProps<T extends string = ThTextSettingsKeys | ThSpacingSettingsKeys> {
  label: string;
  moreLabel: string;
  moreTooltip: string;
  onPressMore: (e: PressEvent) => void;
  componentsMap: Record<string, SettingComponent>;
  prefs?: ThSettingsGroupPref<T>;
  defaultPrefs: {
    main: T[];
    subPanel: T[];
  };
  isDisabled?: boolean;
  compounds?: {
    /** 
     * Custom heading. Can be either:
     * - A React element that will be rendered directly
     * - Props that will be spread onto the default Heading component
     */
    heading?: React.ReactElement<typeof Heading> | WithRef<HeadingProps, HTMLHeadingElement>;
  };
}

export const StatefulGroupWrapper = <T extends string = ThTextSettingsKeys | ThSpacingSettingsKeys>({
  label,
  moreLabel,
  moreTooltip,
  onPressMore,
  componentsMap,
  prefs,
  defaultPrefs,
  isDisabled,
  compounds
}: StatefulGroupWrapperProps<T>) => {
  const { preferences } = usePreferences();
  
  const main = prefs?.main || defaultPrefs.main;
  const displayOrder = prefs?.subPanel !== undefined 
    ? prefs.subPanel 
    : defaultPrefs.subPanel;

  const resolvedPrefs = {
    main: main,
    subPanel: displayOrder
  };
  
  return(
    <>
    <ThSettingsWrapper
      className={ classNames(settingsStyles.group, settingsStyles.advancedGroup) }
      label={ label }
      items={ componentsMap }
      prefs={ resolvedPrefs }
      compounds={{
        ...(compounds?.heading 
          ? { heading: compounds.heading }
          : {
              heading: {
                className: classNames(settingsStyles.label, settingsStyles.groupLabel)
              }
            }),
        button: { 
          className: classNames(readerSharedUI.icon, settingsStyles.advancedIcon), 
          "aria-label": moreLabel, 
          isDisabled: isDisabled, 
          compounds: { 
            tooltipTrigger: { 
              delay: preferences.theming.icon.tooltipDelay, 
              closeDelay: preferences.theming.icon.tooltipDelay 
            }, 
            tooltip: { 
              className: readerSharedUI.tooltip, 
              placement: "top",
              offset: preferences.theming.icon.tooltipOffset || 0
            },
            label: moreTooltip
          },
          onPress: onPressMore
        }
      }}
    />
    </>
  )
}