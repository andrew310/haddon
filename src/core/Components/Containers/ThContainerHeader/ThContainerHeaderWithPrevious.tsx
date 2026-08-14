"use client";

import { WithRef } from "../../customTypes";

import { HeadingProps } from "react-aria-components";
import { ThNavigationButton, ThNavigationButtonProps } from "../../Buttons";
import { ThContainerHeader, ThContainerHeaderProps } from "./ThContainerHeader"

export interface THContainerWithPreviousProps extends ThContainerHeaderProps {
  previousRef?: React.ForwardedRef<HTMLButtonElement>;
  children?: never;
  compounds?: {
    heading: WithRef<HeadingProps, HTMLHeadingElement>;
    button: ThNavigationButtonProps;
  }
}
export const ThContainerHeaderWithPrevious = ({ 
  ref,
  previousRef,
  label,
  compounds,
  ...props 
}: THContainerWithPreviousProps) => {
  return (
    <ThContainerHeader 
      ref={ ref } 
      label={ label }
      { ...props }
      compounds={ { heading: compounds?.heading }}
    >
      <ThNavigationButton ref={ previousRef } { ...compounds?.button } />
    </ThContainerHeader>
  )
}