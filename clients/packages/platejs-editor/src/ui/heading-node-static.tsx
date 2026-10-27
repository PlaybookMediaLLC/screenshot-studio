import { cva } from "class-variance-authority";
import { PathApi, SlateElement, type SlateElementProps } from "../exports/platejs-static";

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

export function HeadingElementStatic({
  children,
  variant = "h1",
  ...props
}: SlateElementProps & {
  variant?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}) {
  const elementPath = props.api.findPath(props.element);
  const isFirstBlock = elementPath ? PathApi.equals(elementPath, [0]) : false;

  return (
    <SlateElement
      as={variant}
      className={headingVariants({ isFirstBlock, variant })}
      {...props}
    >
      {children}
    </SlateElement>
  );
}

export function H1ElementStatic(props: SlateElementProps) {
  return <HeadingElementStatic variant="h1" {...props} />;
}

export function H2ElementStatic(props: SlateElementProps) {
  return <HeadingElementStatic variant="h2" {...props} />;
}

export function H3ElementStatic(props: SlateElementProps) {
  return <HeadingElementStatic variant="h3" {...props} />;
}

export function H4ElementStatic(props: SlateElementProps) {
  return <HeadingElementStatic variant="h4" {...props} />;
}

export function H5ElementStatic(props: SlateElementProps) {
  return <HeadingElementStatic variant="h5" {...props} />;
}

export function H6ElementStatic(props: SlateElementProps) {
  return <HeadingElementStatic variant="h6" {...props} />;
}
