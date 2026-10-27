"use client";

import type { Value } from "platejs";
import { type TPlateEditor, useEditorRef } from "platejs/react";
import { createEditorKit } from "./create-editor-kit";

export const EditorKit = createEditorKit();

export type MyEditor = TPlateEditor<Value, (typeof EditorKit)[number]>;

export const useEditor = () => useEditorRef<MyEditor>();
