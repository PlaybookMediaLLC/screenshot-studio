/**
 * Pins the markdown-kit factory contract: the full options (GFM included)
 * always ride along, so native tables serialize, and app rules for custom
 * nodes merge in without clobbering them. A partial re-configure of the
 * exported kit once dropped remarkPlugins and crashed serializeMd
 * ("Cannot handle unknown node `table`") on every document open.
 */
import { expect, test } from "../../test/bun-test-compat";
import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor } from "platejs";
import { BaseEditorKit } from "../components/editor-base-kit";
import { createMarkdownKit, MarkdownKit } from "./markdown-kit";

const nativeTable = {
  type: "table",
  children: [
    {
      type: "tr",
      children: [
        { type: "th", children: [{ type: "p", children: [{ text: "H" }] }] },
      ],
    },
    {
      type: "tr",
      children: [
        { type: "td", children: [{ type: "p", children: [{ text: "cell" }] }] },
      ],
    },
  ],
};

const canvasEmbed = {
  type: "canvas_embed",
  mode: "frozen",
  savedAt: "",
  artifact: { type: "table", title: "DSO", columns: [], rows: [] },
  children: [{ text: "" }],
};

const serialize = (kit: unknown[], value: unknown[]) => {
  const editor = createSlateEditor({
    plugins: [...BaseEditorKit, ...kit] as never,
    value: value as never,
  });
  return editor.getApi(MarkdownPlugin).markdown.serialize();
};

test("default kit serializes native tables (GFM present)", () => {
  const md = serialize(MarkdownKit, [nativeTable]);
  expect(md).toMatch(/\| H\s+\|/);
  expect(md).toContain("cell");
});

test("factory kit with extra rules keeps native tables AND applies the rule", () => {
  const kit = createMarkdownKit({
    canvas_embed: {
      serialize: () => ({ type: "html", value: "**DSO** exported" }),
    },
  } as never);
  const md = serialize(kit, [nativeTable, canvasEmbed]);
  expect(md).toMatch(/\| H\s+\|/);
  expect(md).toContain("**DSO** exported");
});

test("footnote references and definitions round-trip through GFM markdown", () => {
  const md = serialize(MarkdownKit, [
    {
      type: "p",
      children: [
        { text: "Revenue increased" },
        {
          type: "footnoteReference",
          identifier: "1",
          children: [{ text: "" }],
        },
      ],
    },
    {
      type: "footnoteDefinition",
      identifier: "1",
      children: [{ type: "p", children: [{ text: "Audited statement" }] }],
    },
  ]);

  expect(md).toContain("[^1]");
  expect(md).toContain("[^1]: Audited statement");
});
