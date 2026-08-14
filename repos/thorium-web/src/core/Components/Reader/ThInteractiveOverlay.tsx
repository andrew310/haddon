export interface ThInteractiveOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.ForwardedRef<HTMLDivElement>;
  isActive: boolean;
  children?: never;
}

// This is meant to mount invisible zones that can be hovered, clicked, etc.
export const ThInteractiveOverlay = ({ 
  ref,
  isActive,
  className,
  style,
  ...props 
}: ThInteractiveOverlayProps) => {
  const defaultStyles: React.CSSProperties = {
    opacity: 0,
    zIndex: 10000,
    pointerEvents: "auto",
  };

  const mergedStyles = className 
    ? undefined 
    : {
      ...defaultStyles,
      ...style
    };

  if (isActive) {
    return (
      <div 
        ref={ ref } 
        className={ className }
        style={ mergedStyles }
        { ...props }
      ></div>
    )
  }
}