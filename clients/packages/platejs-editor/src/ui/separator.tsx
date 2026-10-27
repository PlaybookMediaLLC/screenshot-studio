"use client";

import { Root as SeparatorRoot } from "@radix-ui/react-separator";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const separatorVariants = cva("shrink-0 bg-border", {
  defaultVariants: {
    orientation: "horizontal",
  },
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "h-full w-px",
    },
  },
});

export function Separator({
  className,
  decorative = true,
  orientation = "horizontal",
  ...props
}: ComponentProps<typeof SeparatorRoot> &
  VariantProps<typeof separatorVariants>) {
  return (
    <SeparatorRoot
      className={cn(
        separatorVariants({
          orientation,
        }),
        className
      )}
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  );
}
