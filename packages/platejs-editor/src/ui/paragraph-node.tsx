"use client";

import { PlateElement, type PlateElementProps } from "platejs/react";
import type { CSSProperties } from "react";

import { SyncedTag } from "./synced-tag";

export function ParagraphElement(props: PlateElementProps) {
  const backgroundColor = props.element
    .backgroundColor as CSSProperties["backgroundColor"];

  return (
    <PlateElement
      {...props}
      className="group relative px-0.5 py-[3px]"
      style={{
        backgroundColor,
      }}
    >
      <SyncedTag />
      {props.children}
    </PlateElement>
  );
}
