# Menu Components API Documentation

## ThMenu

A menu component that supports custom triggers, items, and popovers.

### Props

```typescript
interface THMenuProps<T> extends MenuProps<ThActionEntry<T>> {
  ref?: React.ForwardedRef<HTMLDivElement>;
  triggerRef?: React.RefObject<HTMLElement | null>;  // Reference to trigger element
  items?: Iterable<ThActionEntry<T>>;                // Collection of menu items
  children?: never;                                  // Children are not allowed
  compounds?: {
    menuTrigger?: Omit<MenuTriggerProps, "children">; // Props for menu trigger
    button?: ThActionButtonProps | React.ReactElement<ThActionButtonProps>; // Custom button or props
    popover?: PopoverProps;                          // Props for popover component
  }
}
```

### Features

- Compound component pattern for flexible configuration
- Support for custom trigger buttons
- Integration with action system through ThActionEntry
- Automatic popover positioning
- Built-in accessibility through react-aria-components

## ThMenuItem

A menu item component that supports icons, labels, and keyboard shortcuts.

### Props

```typescript
interface ThMenuItemProps extends MenuItemProps {
  ref?: React.Ref<HTMLLIElement>;
  id: string;                          // Unique identifier
  SVGIcon?: React.ComponentType<React.SVGProps<SVGElement>>; // Optional icon
  label: string;                       // Item label
  shortcut?: string;                   // Optional keyboard shortcut
  compounds?: {
    label: LabelProps;                 // Props for label component
    shortcut: KeyboardProps;           // Props for shortcut component
  }
}
```

### Features

- Support for SVG icons
- Keyboard shortcut display
- Compound props for label and shortcut customization
- Automatic ARIA labeling

### Accessibility

The menu components implement ARIA best practices:

- Proper menu and menuitem roles
- Keyboard navigation support
- ARIA labels and descriptions
- Focus management
- Screen reader announcements for shortcuts