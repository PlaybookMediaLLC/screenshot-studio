"use client";

import type { TTagElement } from "platejs";
import type { PlateElementProps } from "platejs/react";
import {
  PlateElement,
  useFocused,
  useReadOnly,
  useSelected,
} from "platejs/react";

import { cn } from "../lib/utils";
import { isSafeUrl } from "../lib/safe-url";

export function TagElement(props: PlateElementProps<TTagElement>) {
  const { element } = props;
  const selected = useSelected();
  const focused = useFocused();
  const readOnly = useReadOnly();
  const url = typeof element.url === "string" ? element.url : undefined;
  const safeUrl = url && isSafeUrl(url) ? url : undefined;

  const badge = (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 break-normal rounded-full border border-transparent bg-secondary px-2.5 align-middle font-semibold text-secondary-foreground text-sm transition-colors hover:bg-secondary/60 focus:outline-none",
        selected && focused && "ring-2 ring-ring"
      )}
    >
      {element.value as string}
    </span>
  );

  return (
    <PlateElement
      {...props}
      attributes={{ ...props.attributes, draggable: true }}
      className="m-0.5 inline-flex cursor-pointer select-none"
    >
      {readOnly && safeUrl ? <a href={safeUrl}>{badge}</a> : badge}
      {props.children}
    </PlateElement>
  );
}
