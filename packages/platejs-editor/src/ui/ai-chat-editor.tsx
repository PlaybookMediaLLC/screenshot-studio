"use client";

import { useAIChatEditor } from "@platejs/ai/react";
import { usePlateEditor } from "platejs/react";
import { memo } from "react";

import { BaseEditorKit } from "../components/editor-base-kit";

import { EditorStatic } from "./editor-static";

export const AIChatEditor = memo(function AIChatEditorComponent({
  content,
}: {
  content: string;
}) {
  const aiEditor = usePlateEditor({
    plugins: BaseEditorKit,
  });

  useAIChatEditor(aiEditor, content);

  return <EditorStatic editor={aiEditor} variant="aiChat" />;
});
