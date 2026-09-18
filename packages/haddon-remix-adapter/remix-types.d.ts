/**
 * Type declarations for Remix 3 UI primitives.
 * These are minimal stubs for the adapter; actual types come from 'remix/ui'.
 */

declare module 'remix/ui' {
  export interface Handle {
    update(): void
  }

  export function on<K extends keyof HTMLElementEventMap>(
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): unknown

  export function css(styles: Record<string, any>): unknown

  export function clientEntry<P>(
    path: string,
    component: (props: P) => () => JSX.Element
  ): (props: P) => JSX.Element
}
