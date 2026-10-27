import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionWrapper } from "../components/editor/sections/SectionWrapper";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";

test("radio inputs stay compact and disabled switches retain their native disabled state", () => {
  const radio = renderToStaticMarkup(jsx(Input, { type: "radio", name: "format", value: "png" }));
  assert.match(radio, /name="format"/);
  assert.match(radio, /size-4/);
  assert.doesNotMatch(radio, /h-9|px-3|w-full/);
  const toggle = renderToStaticMarkup(jsx(Switch, {
    checked: true, disabled: true, onCheckedChange: () => assert.fail("disabled switch toggled"),
  }));
  assert.match(toggle, /role="switch"/);
  assert.match(toggle, /aria-checked="true"/);
  assert.match(toggle, /disabled=""/);
});

test("segmented controls expose toggle buttons instead of incomplete tab semantics", async () => {
  const source = await readFile(
    new URL("../components/ui/segmented-control.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /aria-pressed=\{isActive\}/);
  assert.doesNotMatch(source, /role="tablist"|role="tab"|aria-selected/);
});

test("collapsed editor sections hide their controls and connect the disclosure to its content", () => {
  const markup = renderToStaticMarkup(
    jsx(SectionWrapper, {
      title: "Adjust",
      defaultOpen: false,
      children: jsx("button", { children: "Hidden control" }),
    }),
  );
  const controls = markup.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(controls);
  assert.match(markup, /aria-expanded="false"/);
  assert.ok(markup.includes(`id="${controls}" hidden=""`));
});

test("expanded editor sections expose all content without clipping long mobile panels", () => {
  const markup = renderToStaticMarkup(
    jsx(SectionWrapper, {
      title: "Design",
      children: jsx("button", { children: "Visible control" }),
    }),
  );
  assert.match(markup, /aria-expanded="true"/);
  assert.doesNotMatch(markup, /hidden=""|max-h-/);
  assert.match(markup, /Visible control/);
});
