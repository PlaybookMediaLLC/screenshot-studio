"use client";

import { LineHeightPlugin } from "@platejs/basic-styles/react";
import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";
import { WrapTextIcon } from "lucide-react";
import { useEditorRef, useSelectionFragmentProp } from "platejs/react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ToolbarButton } from "./toolbar";

export function LineHeightToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const { defaultNodeValue, validNodeValues = [] } =
    editor.getInjectProps(LineHeightPlugin);
  const value = useSelectionFragmentProp({
    defaultValue: defaultNodeValue,
    getProp: (node) => node.lineHeight,
  });
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu modal={false} onOpenChange={setOpen} open={open} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton isDropdown pressed={open} tooltip="Line height">
          <WrapTextIcon />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          onValueChange={(newValue) => {
            editor
              .getTransforms(LineHeightPlugin)
              .lineHeight.setNodes(Number(newValue));
            editor.tf.focus();
          }}
          value={String(value)}
        >
          {validNodeValues.map((lineHeight) => (
            <DropdownMenuRadioItem
              key={lineHeight}
              value={String(lineHeight)}
            >
              {lineHeight}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
