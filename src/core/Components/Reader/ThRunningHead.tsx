"use client";

import React from "react";

import { HTMLAttributesWithRef } from "../customTypes";

export interface ThRunningHeadProps extends HTMLAttributesWithRef<HTMLHeadingElement> {
  ref?: React.RefObject<HTMLHeadingElement>
  label: string;
}

export const ThRunningHead = ({ 
  ref,
  label,
  ...props
}: ThRunningHeadProps) => {

  return(
    <>
    <h1 
      ref={ ref }
      { ...props }
    >
        { label }
      </h1>
    </>
  )
}