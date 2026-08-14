"use client";

import ArrowDropDownIcon from "./assets/icons/arrow_drop_down.svg";

import { Button, ButtonProps, SelectValue } from "react-aria-components";

export interface ThDropdownButtonProps extends ButtonProps {
  ref?: React.ForwardedRef<HTMLButtonElement>;
}

export const ThDropdownButton = ({
  ref,
  children,
  ...props
}: ThDropdownButtonProps) => {
  return (
    <>
    <Button 
      ref={ ref }
      { ...props }
    >
      { children 
        ? children 
        : <>
          <SelectValue /> 
          <ArrowDropDownIcon aria-hidden="true" focusable="false" />
          </> 
      }
    </Button>
    </>
  )
}