"use client";

import { TextOutdentIcon as IndentDecreaseIcon } from "@phosphor-icons/react/dist/ssr/TextOutdent"
import { TextIndentIcon as IndentIncreaseIcon } from "@phosphor-icons/react/dist/ssr/TextIndent";
import { useEditorRef, useSelectionFragmentProp } from "platejs/react";

import { ToolbarButton } from "./toolbar";

const MAX_TEXT_INDENT = 4;

const useTextIndentButton = (delta: number) => {
  const editor = useEditorRef();
  const value = Number(
    useSelectionFragmentProp({
      defaultValue: "0",
      getProp: (node) => node.textIndent,
    }) ?? 0
  );
  const nextValue = Math.min(MAX_TEXT_INDENT, Math.max(0, value + delta));

  const update = () => {
    editor.tf.withoutNormalizing(() => {
      for (const [, path] of editor.api.blocks({ mode: "lowest" })) {
        if (nextValue === 0) {
          editor.tf.unsetNodes("textIndent", { at: path });
        } else {
          editor.tf.setNodes({ textIndent: nextValue }, { at: path });
        }
      }
    });
    editor.tf.focus();
  };

  return { disabled: nextValue === value, update };
};

export function TextIndentDecreaseToolbarButton() {
  const { disabled, update } = useTextIndentButton(-1);

  return (
    <ToolbarButton disabled={disabled} onClick={update} tooltip="Decrease first-line indent">
      <IndentDecreaseIcon />
    </ToolbarButton>
  );
}

export function TextIndentIncreaseToolbarButton() {
  const { disabled, update } = useTextIndentButton(1);

  return (
    <ToolbarButton disabled={disabled} onClick={update} tooltip="Increase first-line indent">
      <IndentIncreaseIcon />
    </ToolbarButton>
  );
}
