"use client";

import React, { HTMLAttributes } from "react";

import { WithRef } from "../../customTypes";

import SearchIcon from "./assets/icons/search.svg";

import { 
  FieldError, 
  FieldErrorProps, 
  Input, 
  InputProps, 
  Label, 
  LabelProps, 
  SearchField, 
  SearchFieldProps, 
  Text, 
  ValidationResult 
} from "react-aria-components";
import { ThActionButtonProps, ThCloseButton } from "../../Buttons";

export interface ThFormSearchFieldProps extends SearchFieldProps {
  ref?: React.ForwardedRef<HTMLInputElement>;
  label?: string;
  compounds?: {
    label?: WithRef<LabelProps, HTMLLabelElement>;
    input?: WithRef<InputProps, HTMLInputElement>;
    searchIcon?: HTMLAttributes<HTMLDivElement> | React.ReactElement<HTMLDivElement>;
    clearButton?: ThActionButtonProps | React.ReactElement<ThActionButtonProps>;
    description?: string;
    fieldError?: WithRef<FieldErrorProps, HTMLDivElement>;
  },
  errorMessage?: string | ((validation: ValidationResult) => string);
}

export const ThFormSearchField = ({
  ref,
  label,
  children,
  compounds,
  errorMessage,
  ...props
}: ThFormSearchFieldProps) => {
  return(
    <>
    <SearchField
      ref={ ref }
      {...props }
    >
      <>
      { children 
        ? children 
        : <>
          { label && <Label { ...compounds?.label }>
              { label }
            </Label>
          }

          { errorMessage && <FieldError { ...compounds?.fieldError }>
              { errorMessage }
            </FieldError> 
          }
          
          <Input { ...compounds?.input } />

          { compounds?.searchIcon && React.isValidElement(compounds.searchIcon)
           ? compounds.searchIcon
            : <div {...compounds?.searchIcon }>
                <SearchIcon aria-hidden="true" focusable="false" />
              </div>
          }
          
          { compounds?.clearButton && React.isValidElement(compounds.clearButton) 
            ? compounds.clearButton 
            : <ThCloseButton { ...compounds?.clearButton } type="button" />
          }
          
          { compounds?.description && <Text slot="description"> 
              { compounds?.description } 
            </Text> 
          }
          </> 
      }
      </>
    </SearchField>
    </>
  )
}