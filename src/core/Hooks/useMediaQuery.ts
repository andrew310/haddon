"use client";

import { useEffect, useState } from "react";

export const useMediaQuery = (query: string | null) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (!query) return;

    const mq = window.matchMedia(query);

    // Checking if media query is supported or well-formed
    // The media property is the normalized and resolved string representation of the query. 
    // If matchMedia encounters something it doesn’t understand, that changes to "not all"
    const resolvedMediaQuery = mq.media;
    if (query !== resolvedMediaQuery) {
      console.error("Either this query is not supported or not well formed. Please double-check.");
      return;
    };

    if (mq.matches !== matches) {
      setMatches(mq.matches);
    }

    const handleMatch = () => setMatches(mq.matches);
    mq.addEventListener("change", handleMatch);

    return () => mq.removeEventListener("change", handleMatch);
  }, [matches, query]);

  return matches;
}