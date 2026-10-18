"use client";

import {
  Indicator as CheckboxIndicator,
  Root as CheckboxRoot,
} from "@radix-ui/react-checkbox";
import { CheckIcon, SquareIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxRoot>) {
  return (
    <CheckboxRoot
      className={cn(
        "group peer flex size-4 shrink-0 items-center justify-center rounded-none border border-primary bg-primary ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-background data-[state=checked]:text-primary-foreground data-[state=indeterminate]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxIndicator
        className={cn("flex items-center justify-center text-current")}
      >
        <CheckIcon className="inset-0 size-0 group-data-[state=checked]:size-4" />
        <SquareIcon className="size-0 group-data-[state=indeterminate]:size-4" />
      </CheckboxIndicator>
    </CheckboxRoot>
  );
}

export { Checkbox };
