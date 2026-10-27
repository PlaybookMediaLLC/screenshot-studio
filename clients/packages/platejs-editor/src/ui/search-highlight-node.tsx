"use client";

import { type PlateLeafProps, PlateLeaf } from "platejs/react";

export function SearchHighlightLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      className="bg-yellow-200/60 dark:bg-yellow-300/30"
    />
  );
}
