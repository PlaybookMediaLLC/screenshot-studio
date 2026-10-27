import type { SlateElementProps } from "../exports/platejs-static";
import { SlateElement } from "../exports/platejs-static";
import type { CSSProperties } from "react";

export function ParagraphElementStatic(props: SlateElementProps) {
  const backgroundColor = props.element
    .backgroundColor as CSSProperties["backgroundColor"];

  return (
    <SlateElement
      {...props}
      className="my-px px-0.5 py-[3px]"
      style={{
        backgroundColor,
      }}
    >
      {props.children}
    </SlateElement>
  );
}
