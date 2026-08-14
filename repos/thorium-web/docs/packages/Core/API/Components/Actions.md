# Actions Components API Documentation

## ThActionsBar

A toolbar component that serves as a container for action buttons and menus.

### Props

`ThActionsBarProps` extends `ToolbarProps` from react-aria-components:

```typescript
interface ThActionsBarProps extends ToolbarProps {
  ref?: React.ForwardedRef<HTMLDivElement>
}
```

### Types

```typescript
enum ThActionsTriggerVariant {
  button = "iconButton",
  menu = "menuItem"
}

interface ThActionEntry<T> {
  key: T;                               // Unique identifier for the action
  associatedKey?: string;               // Optional associated key for linking actions
  Trigger: React.ComponentType<any>;    // Component that triggers the action
  Target?: React.ComponentType<any>;    // Optional component rendered when action is triggered
}
```

## ThCollapsibleActionsBar

An extension of ThActionsBar that supports collapsible actions with overflow menu functionality.

### Props

```typescript
interface ThCollapsibleActionsBarProps extends ThActionsBarProps {
  id: string;                          // Unique identifier for the collapsible actions bar
  items: ThActionEntry<string>[];      // Array of action items to display
  prefs: CollapsiblePref;              // Preferences for collapsible behavior
  breakpoint?: string;                 // Optional breakpoint for responsive behavior
  compounds?: {
    menu: THMenuProps<string> | React.ReactElement<typeof ThMenu>; // Configuration for overflow menu
  }
}
```

### Features

- Automatically collapses actions into an overflow menu based on preferences and breakpoints
- Supports both button and menu item variants for actions
- Handles associated actions through `associatedKey` property
- Integrates with ThMenu component for overflow menu functionality