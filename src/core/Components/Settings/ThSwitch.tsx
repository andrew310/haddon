"use client";

import { HTMLAttributesWithRef, WithRef } from "../customTypes";

import { Heading, HeadingProps, Switch, SwitchProps } from "react-aria-components";

export interface ThSwitchProps extends SwitchProps {
  ref?: React.ForwardedRef<HTMLLabelElement>;
  label: string;
  heading?: string;
  compounds?: {
    /**
     * Props for the wrapper component. See `HTMLAttributesWithRef` for more information.
     */
    wrapper?: HTMLAttributesWithRef<HTMLDivElement>;
    /**
     * Props for the heading component. See `HeadingProps` for more information.
     */
    heading?: WithRef<HeadingProps, HTMLHeadingElement>;
    /**
     * Props for the indicator component. See `HTMLAttributesWithRef` for more information.
     */
    indicator?: HTMLAttributesWithRef<HTMLDivElement>;
  }
}

export const ThSwitch = ({
  ref,
  label,
  compounds,
  heading, 
  ...props
}: ThSwitchProps) => {
  return(
    <>
    <div { ...compounds?.wrapper }>
      { heading && <Heading { ...compounds?.heading }>
          { heading }
        </Heading> 
      }
      <Switch 
        ref={ ref }
        { ...props }
      >
        <div { ...compounds?.indicator } />
        <span>{ label }</span>
      </Switch>
    </div>
    </>
  )
}