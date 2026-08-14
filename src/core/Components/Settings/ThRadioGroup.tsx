"use client";

import React, { ComponentType, SVGProps, useEffect, useRef } from "react";

import { HTMLAttributesWithRef, WithRef } from "../customTypes";

import { 
  Label, 
  LabelProps, 
  Radio, 
  RadioGroup, 
  RadioGroupProps, 
  RadioProps 
} from "react-aria-components"

export interface ThRadioGroupItems {
  id: string;
  value: string;
  icon?: ComponentType<SVGProps<SVGElement>>;
  label: string;
  isDisabled?: boolean;
}

export interface ThRadioGroupProps extends RadioGroupProps {
  ref?: React.ForwardedRef<HTMLDivElement>;
  label?: string;
  items?: ThRadioGroupItems[];
  compounds?: {
    /**
     * Props for the wrapper component. See `HTMLAttributesWithRef` for more information.
     */
    wrapper?: HTMLAttributesWithRef<HTMLDivElement>;
    /**
     * Props for the label component. See `LabelProps` for more information.
     */
    label?: WithRef<LabelProps, HTMLLabelElement>;
    /**
     * Props for the radio component. See `RadioProps` for more information.
     */
    radio?: Omit<RadioProps, "value">;
    /**
     * Props for the radio label component. See `HTMLAttributesWithRef` for more information.
     */
    radioLabel?: HTMLAttributesWithRef<HTMLSpanElement>;
  }
}

export const ThRadioGroup = ({
  ref,
  label,
  items,
  compounds,
  children,
  value,
  ...props
}: ThRadioGroupProps) => {
  const radioGroupRef = useRef<HTMLDivElement>(null);

  // Auto-detect when value doesn't match items and ensure first radio is focusable
  // Otherwise all inputs will have tabindex -1 and the entire group will be skipped
  // when tabbing.
  useEffect(() => {
    if (items?.length && radioGroupRef.current && value !== undefined) {
      const valueMatches = items.some((item) => item.value === value);

      if (!valueMatches) {
        // When no value matches, make first radio focusable for tab navigation
        const firstRadio = radioGroupRef.current.querySelector("input[type='radio']") as HTMLInputElement;
        if (firstRadio && firstRadio.getAttribute("tabindex") !== "0") {
          firstRadio.setAttribute("tabindex", "0");
        }
      }
      // When value matches, let React Aria handle tabindex completely
    }
  }, [items, value]);

  if (React.isValidElement(children)) {
    return (
      <RadioGroup
        ref={ ref || radioGroupRef }
        value={ value }
        { ...props }
      >
        { label && <Label { ...compounds?.label }>
            { label }
          </Label>
        }
        { children }
      </RadioGroup>
    )
  } else if (items) {
    return (
      <RadioGroup
        ref={ radioGroupRef }
        value={ value }
        { ...props }
      >
        { label && <Label { ...compounds?.label }>
            { label }
          </Label>
        }
        <div { ...compounds?.wrapper }>
          { items.map((item) => (
            <Radio
              { ...compounds?.radio }
              id={ item.id }
              key={ item.id }
              value={ item.value }
              isDisabled={ item.isDisabled }
            >
              <React.Fragment>
                { item.icon && <item.icon aria-hidden="true" focusable="false" /> }
                <span { ...compounds?.radioLabel }>
                  { item.label }
                </span>
              </React.Fragment>
            </Radio>
          )) }
        </div>
      </RadioGroup>
    )
  }
};