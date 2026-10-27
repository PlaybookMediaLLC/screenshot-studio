"use client";

import { Plate, usePlateEditor } from "platejs/react";
import { playgroundValue } from "../examples/playground-value";
import { Editor, EditorContainer } from "../ui/editor";
import { TocSidebar } from "../ui/toc-sidebar";
import { EditorKit } from "./editor-kit";

export function PlateEditor() {
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: playgroundValue,
  });

  return (
    <Plate editor={editor}>
      <TocSidebar className="top-[130px]" topOffset={30} />

      <EditorContainer>
        <Editor placeholder="Type..." variant="demo" />
      </EditorContainer>
    </Plate>
  );
}
