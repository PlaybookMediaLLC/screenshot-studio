"use client";

import {
  Combobox as AriakitCombobox,
  ComboboxGroup as AriakitComboboxGroup,
  ComboboxGroupLabel as AriakitComboboxGroupLabel,
  ComboboxItem as AriakitComboboxItem,
  ComboboxPopover as AriakitComboboxPopover,
  ComboboxProvider as AriakitComboboxProvider,
  ComboboxRow as AriakitComboboxRow,
  Portal as AriakitPortal,
  useComboboxContext,
  useComboboxStore,
} from "@ariakit/react";
import { filterWords } from "@platejs/combobox";
import {
  type UseComboboxInputResult,
  useComboboxInput,
  useHTMLInputCursorState,
} from "@platejs/combobox/react";
import { cva, type VariantProps } from "class-variance-authority";
import type { Point, TElement } from "platejs";
import { useComposedRef, useEditorRef } from "platejs/react";
import type {
  ComponentProps,
  HTMLAttributes,
  ReactNode,
  RefObject,
} from "react";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils";

type FilterFn = (
  item: { value: string; group?: string; keywords?: string[]; label?: string },
  search: string
) => boolean;

type InlineComboboxContextValue = {
  filter: FilterFn | false;
  inputProps: UseComboboxInputResult["props"];
  inputRef: RefObject<HTMLInputElement | null>;
  removeInput: UseComboboxInputResult["removeInput"];
  showTrigger: boolean;
  trigger: string;
  setHasEmpty: (hasEmpty: boolean) => void;
};

const InlineComboboxContext = createContext<InlineComboboxContextValue | null>(
  null
);

const defaultFilter: FilterFn = (
  { group, keywords = [], label, value },
  search
) => {
  const uniqueTerms = new Set(
    [value, ...keywords, group, label].filter((term): term is string =>
      Boolean(term)
    )
  );

  return Array.from(uniqueTerms).some((keyword) =>
    filterWords(keyword, search)
  );
};

function useInlineComboboxContext() {
  const context = useContext(InlineComboboxContext);

  if (!context) {
    throw new Error(
      "InlineCombobox components must be used inside InlineCombobox"
    );
  }

  return context;
}

function useInlineComboboxStore() {
  const store = useComboboxContext();

  if (!store) {
    throw new Error(
      "InlineCombobox components must be used inside an Ariakit ComboboxProvider"
    );
  }

  return store;
}

type InlineComboboxProps = {
  children: ReactNode;
  element: TElement;
  trigger: string;
  filter?: FilterFn | false;
  hideWhenNoValue?: boolean;
  showTrigger?: boolean;
  value?: string;
  setValue?: (value: string) => void;
};

function InlineCombobox({
  children,
  element,
  filter = defaultFilter,
  hideWhenNoValue = false,
  setValue: setValueProp,
  showTrigger = true,
  trigger,
  value: valueProp,
}: InlineComboboxProps) {
  const editor = useEditorRef();
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorState = useHTMLInputCursorState(inputRef);

  const [valueState, setValueState] = useState("");
  const hasValueProp = valueProp !== undefined;
  const value = hasValueProp ? valueProp : valueState;

  const setValue = useCallback(
    (newValue: string) => {
      setValueProp?.(newValue);

      if (!hasValueProp) {
        setValueState(newValue);
      }
    },
    [setValueProp, hasValueProp]
  );

  const insertPoint = useRef<Point | null>(null);

  useEffect(() => {
    const path = editor.api.findPath(element);

    if (!path) return;

    const point = editor.api.before(path);

    if (!point) return;

    const pointRef = editor.api.pointRef(point);
    insertPoint.current = pointRef.current;

    return () => {
      pointRef.unref();
    };
  }, [editor, element]);

  const { props: inputProps, removeInput } = useComboboxInput({
    cancelInputOnBlur: false,
    cursorState,
    ref: inputRef,
    onCancelInput: (cause) => {
      if (cause !== "backspace") {
        editor.tf.insertText(trigger + value, {
          at: insertPoint?.current ?? undefined,
        });
      }
      if (cause === "arrowLeft" || cause === "arrowRight") {
        editor.tf.move({
          distance: 1,
          reverse: cause === "arrowLeft",
        });
      }
    },
  });

  const [hasEmpty, setHasEmpty] = useState(false);

  const contextValue: InlineComboboxContextValue = useMemo(
    () => ({
      filter,
      inputProps,
      inputRef,
      removeInput,
      setHasEmpty,
      showTrigger,
      trigger,
    }),
    [trigger, showTrigger, filter, inputProps, removeInput]
  );

  const store = useComboboxStore({
    setValue: (newValue) => startTransition(() => setValue(newValue)),
  });

  const items = store.useState("items");

  // React.useEffect(() => {
  //   if (!store.getState().activeId) {
  //     store.setActiveId(store.first());
  //   }
  // }, [items, store]);

  return (
    <span contentEditable={false}>
      <AriakitComboboxProvider
        open={
          (items.length > 0 || hasEmpty) &&
          (!hideWhenNoValue || value.length > 0)
        }
        store={store}
      >
        <InlineComboboxContext.Provider value={contextValue}>
          {children}
        </InlineComboboxContext.Provider>
      </AriakitComboboxProvider>
    </span>
  );
}

function InlineComboboxInput({
  className,
  ref: refProp,
  ...props
}: ComponentProps<"input">) {
  const {
    inputProps,
    inputRef: contextRef,
    showTrigger,
    trigger,
  } = useInlineComboboxContext();

  const store = useInlineComboboxStore();
  const value = store.useState("value");

  const ref = useComposedRef(refProp, contextRef);

  return (
    <>
      {showTrigger && trigger}

      <span className="relative min-h-[1lh]">
        <span
          aria-hidden="true"
          className="invisible overflow-hidden text-nowrap"
        >
          {value || props.placeholder || "\u200B"}
        </span>

        <AriakitCombobox
          autoSelect
          className={cn(
            "absolute top-0 left-0 size-full bg-transparent outline-hidden",
            className
          )}
          ref={ref}
          value={value}
          {...inputProps}
          {...props}
        />
      </span>
    </>
  );
}

const comboboxVariants = cva(
  "z-500 mt-1 h-full max-h-[40vh] min-w-[180px] max-w-[calc(100vw-24px)] animate-popover overflow-y-auto rounded-none bg-popover shadow-floating",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "",
        emoji: "max-h-[270px] w-[408px]",
        mention: "w-[300px]",
        slash: "w-[320px]",
      },
    },
  }
);

const comboboxItemVariants = cva(
  "relative mx-1 flex select-none items-center rounded-none px-2 py-1 text-foreground text-sm outline-hidden transition-bg-ease [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      interactive: true,
    },
    variants: {
      interactive: {
        false: "",
        true: "cursor-pointer hover:bg-accent hover:text-accent-foreground data-[active-item=true]:bg-accent data-[active-item=true]:text-accent-foreground",
      },
    },
  }
);

function InlineComboboxContent({
  className,
  variant,
  ...props
}: ComponentProps<typeof AriakitComboboxPopover> &
  VariantProps<typeof comboboxVariants>) {
  return (
    <AriakitPortal>
      <AriakitComboboxPopover
        className={cn(comboboxVariants({ variant }), className)}
        {...props}
      >
        {props.children}
      </AriakitComboboxPopover>
    </AriakitPortal>
  );
}

function InlineComboboxItem({
  className,
  focusEditor = true,
  group,
  keywords,
  label,
  onClick,
  ...props
}: {
  focusEditor?: boolean;
  group?: string;
  keywords?: string[];
  label?: string;
} & ComponentProps<typeof AriakitComboboxItem> &
  Required<Pick<ComponentProps<typeof AriakitComboboxItem>, "value">>) {
  const { value } = props;

  const { filter, removeInput } = useInlineComboboxContext();

  const store = useInlineComboboxStore();
  const search = store.useState("value");

  const visible = useMemo(
    () => !filter || filter({ group, keywords, label, value }, search),
    [filter, group, keywords, value, label, search]
  );

  if (!visible) return null;

  return (
    <AriakitComboboxItem
      className={cn(comboboxItemVariants(), className)}
      onClick={(event) => {
        removeInput(focusEditor);
        onClick?.(event);
      }}
      {...props}
    />
  );
}

function InlineComboboxEmpty({
  children,
  className,
}: HTMLAttributes<HTMLDivElement>) {
  const { setHasEmpty } = useInlineComboboxContext();
  const store = useInlineComboboxStore();
  const items = store.useState("items");

  useEffect(() => {
    setHasEmpty(true);

    return () => {
      setHasEmpty(false);
    };
  }, [setHasEmpty]);

  if (items.length > 0) return null;

  return (
    <div
      className={cn(
        comboboxItemVariants({ interactive: false }),
        "my-1.5 text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

function InlineComboboxGroup({
  className,
  ...props
}: ComponentProps<typeof AriakitComboboxGroup>) {
  return (
    <AriakitComboboxGroup
      className={cn(
        "hidden not-last:border-b py-1.5 [&:has([role=option])]:block",
        className
      )}
      {...props}
    />
  );
}

function InlineComboboxGroupLabel({
  className,
  ...props
}: ComponentProps<typeof AriakitComboboxGroupLabel>) {
  return (
    <AriakitComboboxGroupLabel
      className={cn(
        "mt-1.5 mb-2 px-3 font-medium text-muted-foreground text-xs",
        className
      )}
      {...props}
    />
  );
}

const InlineComboboxRow = AriakitComboboxRow;

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
  InlineComboboxRow,
};
