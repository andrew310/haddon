"use client";

import React from "react";
import { KeyboardProps } from "react-aria";

import { WithRef } from "../customTypes";

import { Keyboard, LabelProps, MenuItem, MenuItemProps, Text } from "react-aria-components";

export interface ThMenuItemProps extends MenuItemProps {
  ref?: React.Ref<HTMLDivElement>;
  id: string;
  SVGIcon?: React.ComponentType<React.SVGProps<SVGElement>>;
  label: string;
  shortcut?: string;
  compounds?: {
    label: WithRef<LabelProps, HTMLSpanElement>;
    shortcut: WithRef<KeyboardProps, HTMLSpanElement>;
  }
}

export const ThMenuItem = ({
  ref,
  id,
  SVGIcon,
  label, 
  shortcut,
  compounds,
  children,
  ...props
}: ThMenuItemProps) => {
  const menuItemLabelId = `${ id }-label`;  
  return(
    <>
    <MenuItem 
      ref={ ref }
      id={ id } 
      { ...(children ? {} : { "aria-labelledby": menuItemLabelId }) }
      { ...props }
    >
      { children 
        ? children 
        : <>
          { SVGIcon && <SVGIcon aria-hidden="true" focusable="false" /> }
          <Text 
            { ...compounds?.label } 
            slot="label"
            id={ menuItemLabelId }
          >
            { label }
          </Text>
          { shortcut && <Keyboard { ...compounds?.shortcut }>{ shortcut }</Keyboard> }
        </>
      }
    </MenuItem>
    </>
  )
}