// We have to patch React Aria Components as they do not define ref in their prop types

export interface HTMLAttributesWithRef<T> extends React.HTMLAttributes<T> {
  ref?: React.ForwardedRef<T>;
}

export type WithRef<T, K> = T & {
  ref?: React.ForwardedRef<K | null>;
};