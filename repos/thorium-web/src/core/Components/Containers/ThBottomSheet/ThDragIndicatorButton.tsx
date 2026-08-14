"use client";

import HorizontalRule from "./assets/icons/horizontal_rule.svg";

import { Button, ButtonProps } from "react-aria-components";

export interface ThDragIndicatorButtonProps extends ButtonProps {
  ref?: React.ForwardedRef<HTMLButtonElement>;
}

export const ThDragIndicatorButton = ({
  ref,
  children,
  ...props
}: ThDragIndicatorButtonProps) => {
  return (
    <>
    <Button 
      ref={ ref }
      { ...props }
    >
      { children ? children : <HorizontalRule aria-hidden="true" focusable="false" /> }
    </Button>
    </>
  )
}