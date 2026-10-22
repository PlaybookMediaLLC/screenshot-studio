"use client";

import { FontWeightPlugin } from "@platejs/basic-styles/react";
import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";
import { PiTextB as WeightIcon } from "react-icons/pi";
import { KEYS } from "platejs";
import { useEditorPlugin, useEditorSelector } from "platejs/react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ToolbarButton } from "./toolbar";

const FONT_WEIGHTS = [
  { label: "Normal", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
  { label: "Bold", value: "700" },
] as const;

export function FontWeightToolbarButton(props: DropdownMenuProps) {
  const { editor, tf } = useEditorPlugin(FontWeightPlugin);
  const value = useEditorSelector(
    (currentEditor) =>
      String(currentEditor.api.marks()?.[KEYS.fontWeight] ?? "400"),
    []
  );
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu modal={false} onOpenChange={setOpen} open={open} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton isDropdown pressed={open} tooltip="Font weight">
          <WeightIcon />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          onValueChange={(newValue) => {
            tf.fontWeight.addMark(newValue);
            editor.tf.focus();
          }}
          value={value}
        >
          {FONT_WEIGHTS.map(({ label, value: itemValue }) => (
            <DropdownMenuRadioItem
              key={itemValue}
              style={{ fontWeight: itemValue }}
              value={itemValue}
            >
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
