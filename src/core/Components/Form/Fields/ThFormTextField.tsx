"use client";

import { WithRef } from "../../customTypes";

import { 
  FieldError, 
  FieldErrorProps, 
  Input, 
  InputProps, 
  Label, 
  LabelProps, 
  Text, 
  TextField, 
  TextFieldProps, 
  ValidationResult 
} from "react-aria-components";

export interface ThFormTextFieldProps extends TextFieldProps {
  ref?: React.ForwardedRef<HTMLInputElement>;
  label?: string;
  compounds?: {
    label?: WithRef<LabelProps, HTMLLabelElement>;
    input?: WithRef<InputProps, HTMLInputElement>;
    description?: string;
    fieldError?: WithRef<FieldErrorProps, HTMLDivElement>;
  },
  errorMessage?: string | ((validation: ValidationResult) => string);
}

export const ThFormTextField = ({
  ref,
  label,
  children,
  compounds,
  errorMessage,
  ...props
}: ThFormTextFieldProps) => {
  return(
    <>
    <TextField
      ref={ ref }
      {...props }
    >
      <>
      { children 
        ? children 
        : <>
          { label && <Label {...compounds?.label }>
              { label }
            </Label>
          }
          
          { errorMessage && <FieldError { ...compounds?.fieldError }>
              { errorMessage }
            </FieldError> 
          }
          
          <Input {...compounds?.input } />
          
          { compounds?.description && <Text slot="description"> 
              { compounds?.description } 
            </Text> 
          }
          </> 
      }
      </>
    </TextField>
    </>
  )
}