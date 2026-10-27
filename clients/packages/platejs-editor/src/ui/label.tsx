"use client";

import { Root as LabelRoot } from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const labelVariants = cva(
  "font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
);

export function Label({
  className,
  disabled,
  ...props
}: ComponentProps<typeof LabelRoot> & {
  disabled?: boolean;
} & VariantProps<typeof labelVariants>) {
  return (
    <LabelRoot
      className={cn(
        labelVariants(),
        disabled && "cursor-not-allowed text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
