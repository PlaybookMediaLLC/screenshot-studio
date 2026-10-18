"use client";

import type { Alignment } from "@platejs/basic-styles";
import { TextAlignPlugin } from "@platejs/basic-styles/react";
import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
} from "lucide-react";
import { useEditorPlugin, useSelectionFragmentProp } from "platejs/react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ToolbarButton } from "./toolbar";

const ALIGNMENTS = [
  { icon: AlignLeftIcon, label: "Left", value: "left" },
  { icon: AlignCenterIcon, label: "Center", value: "center" },
  { icon: AlignRightIcon, label: "Right", value: "right" },
  { icon: AlignJustifyIcon, label: "Justify", value: "justify" },
] as const;

export function AlignToolbarButton(props: DropdownMenuProps) {
  const { editor, tf } = useEditorPlugin(TextAlignPlugin);
  const value =
    useSelectionFragmentProp({
      defaultValue: "left",
      getProp: (node) => node.align,
    }) ?? "left";
  const [open, setOpen] = useState(false);
  const Icon =
    ALIGNMENTS.find((item) => item.value === value)?.icon ?? AlignLeftIcon;

  return (
    <DropdownMenu modal={false} onOpenChange={setOpen} open={open} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton isDropdown pressed={open} tooltip="Align text">
          <Icon />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          onValueChange={(newValue) => {
            tf.textAlign.setNodes(newValue as Alignment);
            editor.tf.focus();
          }}
          value={value}
        >
          {ALIGNMENTS.map(({ icon: ItemIcon, label, value: itemValue }) => (
            <DropdownMenuRadioItem key={itemValue} value={itemValue}>
              <ItemIcon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
