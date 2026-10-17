"use client";

import { Plate, usePlateEditor } from "platejs/react";

import { EditorKit } from "../components/editor-kit";
import { Editor, EditorContainer } from "../ui/editor";
import { TocSidebar } from "../ui/toc-sidebar";
import { tocValue } from "./toc-value";

export default function TocDemo() {
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: tocValue,
  });

  return (
    <Plate editor={editor}>
      <TocSidebar className="*:top-12" topOffset={30} />

      <EditorContainer className="flex" variant="demo">
        <Editor className="h-fit" variant="demo" />
      </EditorContainer>
    </Plate>
  );
}
