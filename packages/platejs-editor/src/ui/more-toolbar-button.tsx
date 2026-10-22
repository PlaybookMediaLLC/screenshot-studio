"use client";

import { BlockMenuPlugin } from "@platejs/selection/react";
import { PiDotsThree as MoreHorizontal } from "react-icons/pi";
import { useEditorRef } from "platejs/react";

import { useOpenState } from "./dropdown-menu";
import { ToolbarButton } from "./toolbar";

export function MoreToolbarButton() {
  const editor = useEditorRef();
  const openState = useOpenState();

  return (
    <ToolbarButton
      data-plate-prevent-overlay
      onClick={(e) => {
        const blockAbove = editor.api.block()?.[0];

        if (!blockAbove) return;

        editor
          .getApi(BlockMenuPlugin)
          .blockMenu.showContextMenu(blockAbove.id as string, {
            x: e.clientX,
            y: e.clientY,
          });
      }}
      pressed={openState.open}
      tooltip="More"
    >
      <MoreHorizontal />
    </ToolbarButton>
  );
}
