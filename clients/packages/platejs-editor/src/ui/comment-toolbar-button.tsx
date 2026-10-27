"use client";

import { ChatTextIcon as MessageSquareTextIcon } from "@phosphor-icons/react/dist/ssr/ChatText";
import { useEditorRef } from "platejs/react";

import { commentPlugin } from "../plugins/comment-kit";

import { ToolbarButton } from "./toolbar";

export function CommentToolbarButton() {
  const editor = useEditorRef();

  return (
    <ToolbarButton
      data-plate-prevent-overlay
      onClick={() => {
        editor.getTransforms(commentPlugin).comment.setDraft();
      }}
      shortcut="⌘+Shift+M"
      tooltip="Comment"
    >
      <MessageSquareTextIcon className="mr-1" />
      <span className="hidden sm:inline">Comment</span>
    </ToolbarButton>
  );
}
