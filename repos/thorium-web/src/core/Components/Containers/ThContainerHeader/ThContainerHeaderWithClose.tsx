"use client";

import { WithRef } from "../../customTypes";

import { HeadingProps } from "react-aria-components";
import { ThActionButtonProps, ThCloseButton } from "../../Buttons";
import { ThContainerHeader, ThContainerHeaderProps } from "./ThContainerHeader"

export interface THContainerWithCloseProps extends ThContainerHeaderProps {
  closeRef?: React.ForwardedRef<HTMLButtonElement>;
  children?: never;
  compounds?: {
    heading: WithRef<HeadingProps, HTMLHeadingElement>;
    button: ThActionButtonProps;
  }
}
export const ThContainerHeaderWithClose = ({ 
  ref,
  closeRef,
  label,
  compounds,
  ...props 
}: THContainerWithCloseProps) => {
  return (
    <ThContainerHeader 
      ref={ ref } 
      label={ label }
      { ...props }
      compounds={ { heading: compounds?.heading }}
    >
      <ThCloseButton ref={ closeRef } { ...compounds?.button } />
    </ThContainerHeader>
  )
}