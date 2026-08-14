"use client";

import React from "react";

import { ThSettingsWrapperButton } from "./ThSettingsWrapperButton";

import { Heading, HeadingProps } from "react-aria-components";
import { HTMLAttributesWithRef, WithRef } from "../../customTypes";
import { ThActionButtonProps } from "../../Buttons";

export interface ThSettingsEntry {
  Comp: React.ComponentType<any>
}

export interface ThSettingsPrefs {
  main: string[];
  subPanel?: string[] | null;
}

export interface ThSettingsWrapperProps extends HTMLAttributesWithRef<HTMLDivElement> {
  /**
   * Label for advanced settings that will be displayed as a heading
   */
  label?: string;
  items?: Record<string, ThSettingsEntry> | null;
  prefs: ThSettingsPrefs;
  compounds?: {
    /**
     * Props for the heading. Can be either:
     * - A React element that will be rendered directly
     * - Props that will be spread onto the default Heading component
     */
    heading?: WithRef<HeadingProps, HTMLHeadingElement> | React.ReactElement<typeof Heading>;
    /**
     * Props for the button that triggers the subpanel. See `ThActionButtonProps` for more information.
     */
    button?: ThActionButtonProps;
  }
}

// TODO: Handle Standalone and Usage as Group
export const ThSettingsWrapper = ({
  ref,
  label,
  items,
  prefs,
  compounds,
  ...props
}: ThSettingsWrapperProps) => {
  const main = prefs.main;
  const displayOrder = prefs.subPanel;
  
  const isAdvanced = items && (
    main.length < Object.keys(items).length && 
    displayOrder && displayOrder.length > 0
  );

  if (items) {
    return(
      <>
      <div 
        ref={ ref }
        { ...props }
      >
        { isAdvanced && (compounds?.heading && React.isValidElement(compounds.heading)
          ? compounds.heading
          : label && (
              <Heading { ...(compounds?.heading || {}) }>
                { label }
              </Heading>
            )
        ) }
        { main.map((key, index) => {
          const match = items[key];
          return match && <match.Comp key={ key } standalone={ !isAdvanced || index !== 0 } { ...props } />;
        }) }
        { isAdvanced && (
          <ThSettingsWrapperButton
            { ...compounds?.button }
          />
        ) }
      </div>
      </>
    )
  }
}