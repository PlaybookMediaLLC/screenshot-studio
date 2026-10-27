import { beforeAll, expect, test } from "../../test/bun-test-compat";
import JSZip from "jszip";

// `importDocx` is browser-only: it parses mammoth's HTML with `DOMParser` and
// deserializes through the DOM, and mammoth's Node build hangs under Bun while
// its browser build reads the `arrayBuffer` that `importDocx` passes. Provide a
// jsdom DOM and point the bare `mammoth` import at its browser bundle so the
// real export -> import round-trip can run. Under Node, test/esm-hooks.mjs
// resolves `mammoth` to its browser bundle. Specifiers are widened to `string`
// so the type-checker does not require declarations this package doesn't ship,
// and both modules are already hoisted into the workspace at runtime.
const JSDOM_SPECIFIER: string = "jsdom";

beforeAll(async () => {
  const { JSDOM } = (await import(JSDOM_SPECIFIER)) as {
    JSDOM: new (html: string) => { window: Record<string, unknown> };
  };
  const { window } = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.DOMParser = window.DOMParser;
  globals.Node = window.Node;
  globals.HTMLElement = window.HTMLElement;
  // Bun's 5 s default is not enough for this hook on a loaded machine: it cold
  // imports jsdom and mammoth's browser bundle, which together took 5.4 s in a
  // parallel `turbo run test`. The work is one-time setup, not the assertion,
  // so a generous ceiling removes a flake without weakening the test.
}, 60_000);

test("DOCX export and re-import round-trips the document text", async () => {
  // Imported after the mammoth mock is registered so `importDocx` binds to the
  // browser build rather than the Node build captured at first load.
  const { exportToDocx, importDocx } = await import("@platejs/docx-io");
  const { createSlateEditor, NodeApi } = await import("platejs");
  const { BaseEditorKit } = await import("../components/editor-base-kit");
  const { EditorStatic } = await import("../ui/editor-static");

  const text = "Quarterly revenue was $1.25M";
  const blob = await exportToDocx([{ type: "p", children: [{ text }] }], {
    editorPlugins: BaseEditorKit,
    editorStaticComponent: EditorStatic,
    title: "Revenue report",
  });
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await archive.file("word/document.xml")?.async("text");

  expect(blob.size).toBeGreaterThan(500);
  expect(documentXml).toContain(text);

  // Re-import the exported archive so a broken round-trip fails loudly instead
  // of the test merely asserting that `importDocx` exists.
  const editor = createSlateEditor({ plugins: BaseEditorKit });
  const result = await importDocx(editor, await blob.arrayBuffer());

  expect(
    NodeApi.string({ children: result.nodes, type: "root" })
  ).toContain(text);
  // Same reason as the hook: this cold imports four modules and runs a full
  // DOCX export/import round-trip, which exceeds Bun's 5 s default under a
  // parallel test run.
}, 60_000);
