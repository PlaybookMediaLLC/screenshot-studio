"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { LinkIcon as Link2 } from "@phosphor-icons/react/dist/ssr/Link";
import { PathApi } from "platejs";
import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import { Button } from "./button";
import { SyncedTag } from "./synced-tag";

const headingVariants = cva(
  "relative mb-1 px-0.5 py-[3px] font-semibold leading-[1.3]!",
  {
    variants: {
      isFirstBlock: {
        false: "",
        true: "mt-0!",
      },
      variant: {
        h1: "mt-8 text-[1.875em]",
        h2: "mt-[1.4em] text-[1.5em]",
        h3: "mt-[1em] text-[1.25em]",
        h4: "mt-[0.9em] text-[1.125em]",
        h5: "mt-[0.8em] text-[1em]",
        h6: "mt-[0.8em] text-[0.875em] uppercase tracking-wide",
      },
    },
  }
);

export function HeadingElement({
  attributes,
  variant = "h1",
  ...props
}: PlateElementProps & VariantProps<typeof headingVariants>) {
  const isFirstBlock = PathApi.equals(props.path, [0]);
  const headingTag = variant ?? "h1";

  return (
    <PlateElement
      as={headingTag}
      attributes={{
        id: props.element.id as string,
        ...attributes,
      }}
      className={`${headingVariants({ isFirstBlock, variant: headingTag })}group`}
      {...props}
    >
      <SyncedTag />
      <span className="group/heading relative inline-flex w-full items-center">
        {props.children}
        {props.element.id && (
          <Button
            className="ml-2 opacity-0 transition-opacity group-hover/heading:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              const id = props.element.id as string;

              try {
                const url = new URL(window.location.href);
                const href = `${url.pathname + (url.search || "")}#${id}`;

                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(href).catch(() => null);
                }
              } catch {
                return;
              }
            }}
            size="xs"
            tooltip="Copy link to heading"
            variant="ghost"
          >
            <Link2 className="size-4" />
          </Button>
        )}
      </span>
    </PlateElement>
  );
}

export function H1Element(props: PlateElementProps) {
  return <HeadingElement variant="h1" {...props} />;
}

export function H2Element(props: PlateElementProps) {
  return <HeadingElement variant="h2" {...props} />;
}

export function H3Element(props: PlateElementProps) {
  return <HeadingElement variant="h3" {...props} />;
}

export function H4Element(props: PlateElementProps) {
  return <HeadingElement variant="h4" {...props} />;
}

export function H5Element(props: PlateElementProps) {
  return <HeadingElement variant="h5" {...props} />;
}

export function H6Element(props: PlateElementProps) {
  return <HeadingElement variant="h6" {...props} />;
}
