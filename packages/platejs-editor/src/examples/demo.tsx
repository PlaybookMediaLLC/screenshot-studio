import { Plate, usePlateEditor } from "platejs/react";

import { EditorKit } from "../components/editor-kit";
import { Editor, EditorContainer } from "../ui/editor";
import { DEMO_VALUES } from "./demo-values";

export default function Demo({ id }: { id: keyof typeof DEMO_VALUES }) {
  const editor = usePlateEditor({
    plugins: EditorKit,
    // biome-ignore lint/suspicious/noExplicitAny: complex type
    value: DEMO_VALUES[id] as any,
  });

  return (
    <Plate editor={editor}>
      <EditorContainer variant="demo">
        <Editor variant="demo" />
      </EditorContainer>
    </Plate>
  );
}
