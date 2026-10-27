import type { SlateElementProps, TLinkElement } from "../exports/platejs-static";
import { SlateElement } from "../exports/platejs-static";

export function LinkElementStatic(props: SlateElementProps<TLinkElement>) {
  return (
    <SlateElement
      {...props}
      as="a"
      className="font-medium text-primary underline decoration-primary underline-offset-4"
    >
      {props.children}
    </SlateElement>
  );
}
