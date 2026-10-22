"use client";

import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";

import { PiCaretDown as ChevronDownIcon, PiCode as Code2Icon, PiColumns as Columns3Icon, PiTextHOne as Heading1Icon, PiTextHTwo as Heading2Icon, PiTextHThree as Heading3Icon, PiTextHFour as Heading4Icon, PiTextHFive as Heading5Icon, PiTextHSix as Heading6Icon, PiLightbulb as LightbulbIcon, PiList as ListIcon, PiListNumbers as ListOrderedIcon, PiParagraph as PilcrowIcon, PiQuotes as QuoteIcon, PiSquare as SquareIcon } from "react-icons/pi";
import { KEYS } from "platejs";
import { useEditorRef, useSelectionFragmentProp } from "platejs/react";
import { useMemo } from "react";
import { getBlockType, setBlockType } from "../components/transforms";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useOpenState,
} from "./dropdown-menu";
import { ToolbarButton } from "./toolbar";

type BlockTypeNode = Parameters<typeof getBlockType>[0];

export const turnIntoItems = [
  {
    icon: <PilcrowIcon />,
    keywords: ["paragraph"],
    label: "Text",
    value: KEYS.p,
  },
  {
    icon: <Heading1Icon />,
    keywords: ["title", "h1"],
    label: "Heading 1",
    value: KEYS.h1,
  },
  {
    icon: <Heading2Icon />,
    keywords: ["subtitle", "h2"],
    label: "Heading 2",
    value: KEYS.h2,
  },
  {
    icon: <Heading3Icon />,
    keywords: ["subtitle", "h3"],
    label: "Heading 3",
    value: KEYS.h3,
  },
  {
    icon: <Heading4Icon />,
    keywords: ["heading", "h4"],
    label: "Heading 4",
    value: KEYS.h4,
  },
  {
    icon: <Heading5Icon />,
    keywords: ["heading", "h5"],
    label: "Heading 5",
    value: KEYS.h5,
  },
  {
    icon: <Heading6Icon />,
    keywords: ["heading", "h6"],
    label: "Heading 6",
    value: KEYS.h6,
  },
  {
    icon: <SquareIcon />,
    keywords: ["checklist", "task", "checkbox", "[]"],
    label: "To-do list",
    value: KEYS.listTodo,
  },
  {
    icon: <ListIcon />,
    keywords: ["unordered", "ul", "-"],
    label: "Bulleted list",
    value: KEYS.ul,
  },
  {
    icon: <ListOrderedIcon />,
    keywords: ["ordered", "ol", "1"],
    label: "Numbered list",
    value: KEYS.ol,
  },
  {
    icon: <ChevronDownIcon />,
    keywords: ["collapsible", "expandable"],
    label: "Toggle list",
    value: KEYS.toggle,
  },
  {
    icon: <Code2Icon />,
    keywords: ["```"],
    label: "Code",
    value: KEYS.codeBlock,
  },
  {
    icon: <QuoteIcon />,
    keywords: ["citation", "blockquote", ">"],
    label: "Quote",
    value: KEYS.blockquote,
  },
  {
    icon: <LightbulbIcon />,
    keywords: ["highlight", "note", "important"],
    label: "Callout",
    value: KEYS.callout,
  },
  {
    icon: <Columns3Icon />,
    label: "3 columns",
    value: "action_three_columns",
  },
];

export function TurnIntoToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const openState = useOpenState();

  const value = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as BlockTypeNode),
  });
  const selectedItem = useMemo(
    () =>
      turnIntoItems.find((item) => item.value === (value ?? KEYS.p)) ??
      turnIntoItems[0],
    [value]
  );

  return (
    <DropdownMenu modal={false} {...openState} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton isDropdown pressed={openState.open} tooltip="Turn into">
          {selectedItem.label}
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuPortal>
        <DropdownMenuContent
          align="start"
          className="ignore-click-outside/toolbar min-w-0"
          data-plate-prevent-overlay
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Turn into</DropdownMenuLabel>

            <DropdownMenuRadioGroup
              className="flex flex-col gap-0.5"
              onValueChange={(type) => {
                setBlockType(editor, type);
                editor.tf.focus();
              }}
              value={selectedItem.value}
            >
              {turnIntoItems.map(({ icon, label, value: itemValue }) => (
                <DropdownMenuRadioItem
                  className="min-w-[180px]"
                  key={itemValue}
                  value={itemValue}
                >
                  <div className="mr-2 flex size-5 items-center justify-center rounded-none border border-foreground/15 bg-background p-0.5 text-subtle-foreground [&_svg]:size-3">
                    {icon}
                  </div>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
