"use client";

import {
  Indicator as ProgressIndicator,
  Root as ProgressRoot,
} from "@radix-ui/react-progress";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

export function Progress({
  className,
  value,
  ...props
}: ComponentProps<typeof ProgressRoot>) {
  return (
    <ProgressRoot
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressIndicator
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressRoot>
  );
}
