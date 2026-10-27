"use client";

import { useCallback, useEffect, useState } from "react";

const getMediaQueryMatches = (mediaQuery: string): boolean => {
  if (typeof window !== "undefined") {
    return window.matchMedia(mediaQuery).matches;
  }

  return false;
};

/** Checks if the current viewport matches the specified media query. */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState<boolean>(getMediaQueryMatches(query));
  const handleChange = useCallback(() => {
    setMatches(getMediaQueryMatches(query));
  }, [query]);

  useEffect(() => {
    const matchMedia = window.matchMedia(query);

    // Triggered at the first client-side load and if query changes
    handleChange();

    // Listen matchMedia
    if (matchMedia.addListener) {
      matchMedia.addListener(handleChange);
    } else {
      matchMedia.addEventListener("change", handleChange);
    }

    return () => {
      if (matchMedia.removeListener) {
        matchMedia.removeListener(handleChange);
      } else {
        matchMedia.removeEventListener("change", handleChange);
      }
    };
  }, [query, handleChange]);

  return matches;
};
