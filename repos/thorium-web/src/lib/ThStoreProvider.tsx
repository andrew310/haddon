"use client";

import { useRef } from "react";
import { Provider } from "react-redux";
import { makeStore, AppStore } from "./store";

export const ThStoreProvider = ({
  storageKey,
  store,
  children
}: {
  storageKey?: string,
  store?: AppStore,
  children: React.ReactNode
}) => {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = store || makeStore(storageKey);
  }

  return <Provider store={ storeRef.current }>{ children }</Provider>
}

export default ThStoreProvider;