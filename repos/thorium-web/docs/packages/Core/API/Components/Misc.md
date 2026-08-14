# Misc Components

## ThGrid

A grid component for displaying items in a grid layout.

### Props

```tsx
interface ThGridProps<T> extends HTMLAttributesWithRef<HTMLDivElement> {
  items: T[];
  children?: never;
  renderItem: (item: T, index: number) => React.ReactNode;
  columnWidth?: number;
  gap?: number;
}
```

### Features

- Responsive grid layout
- Customizable column width and gap
- Customizable item rendering
