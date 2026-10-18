"use client";

import {
  Anchor as PopoverAnchorPrimitive,
  Content as PopoverContentPrimitive,
  Portal as PopoverPortal,
  Root as PopoverRoot,
  Trigger as PopoverTriggerPrimitive,
} from "@radix-ui/react-popover";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const popoverVariants = cva(
  cn(
    "group/popover",
    "z-50 max-w-[calc(100vw-24px)] animate-popover overflow-hidden rounded-none bg-popover text-popover-foreground shadow-floating outline-hidden"
  ),
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        combobox: "",
        default: "w-72",
        equation: "w-[400px] rounded-none px-2.5 py-2",
        equationInline: "w-[400px] rounded-none px-2.5 py-2",
        media: "max-h-[70vh] min-w-[180px] rounded-none",
      },
    },
  }
);

function Popover({ ...props }: ComponentProps<typeof PopoverRoot>) {
  return <PopoverRoot data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: ComponentProps<typeof PopoverTriggerPrimitive>) {
  return <PopoverTriggerPrimitive data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({
  ...props
}: ComponentProps<typeof PopoverAnchorPrimitive>) {
  return <PopoverAnchorPrimitive data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  align = "center",
  className,
  sideOffset = 4,
  variant,
  ...props
}: ComponentProps<typeof PopoverContentPrimitive> &
  VariantProps<typeof popoverVariants>) {
  return (
    <PopoverPortal>
      <PopoverContentPrimitive
        align={align}
        className={cn(popoverVariants({ variant }), className)}
        data-slot="popover-content"
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPortal>
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  popoverVariants,
};
