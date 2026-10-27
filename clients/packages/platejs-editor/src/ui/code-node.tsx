"use client";

import { PlateLeaf, type PlateLeafProps } from "platejs/react";

export function CodeLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      as="code"
      className="whitespace-pre-wrap rounded-none bg-muted px-[0.3em] py-[0.2em] text-sm"
    />
  );
}
