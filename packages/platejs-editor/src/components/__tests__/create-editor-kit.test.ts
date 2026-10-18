import { createSlatePlugin } from "platejs";
import { describe, expect, it } from "../../../test/bun-test-compat";

import { createEditorKit, EDITOR_RECIPES } from "../create-editor-kit";

describe("createEditorKit", () => {
  it("builds the full recipe without duplicate plugin keys", () => {
    const plugins = createEditorKit();
    const pluginKeys = plugins.map((plugin) => plugin.key);

    expect(new Set(pluginKeys).size).toBe(pluginKeys.length);
    expect(pluginKeys).toContain("aiChat");
    expect(pluginKeys).toContain("table");
    expect(pluginKeys).toContain("comment");
    expect(pluginKeys).toContain("csv");
    expect(pluginKeys).toContain("footnoteReference");
    expect(pluginKeys).toContain("h6");
    expect(pluginKeys).toContain("highlight");
    expect(pluginKeys).toContain("kbd");
    expect(pluginKeys).toContain("fontWeight");
    expect(pluginKeys).toContain("lineHeight");
    expect(pluginKeys).toContain("tabbable");
    expect(pluginKeys).toContain("textAlign");
    expect(pluginKeys).toContain("textIndent");
  });

  it("keeps the minimal recipe focused on core editing", () => {
    const pluginKeys = createEditorKit({ recipe: "minimal" }).map(
      (plugin) => plugin.key
    );

    expect(pluginKeys).toContain("p");
    expect(pluginKeys).not.toContain("aiChat");
    expect(pluginKeys).not.toContain("table");
    expect(pluginKeys).not.toContain("comment");
    expect(pluginKeys).not.toContain("csv");
    expect(pluginKeys).not.toContain("footnoteReference");
    expect(pluginKeys).toContain("h6");
    expect(pluginKeys).toContain("highlight");
    expect(pluginKeys).toContain("lineHeight");
    expect(pluginKeys).toContain("tabbable");
    expect(pluginKeys).toContain("textAlign");
  });

  it("supports exclusions and additional plugins", () => {
    const CustomPlugin = createSlatePlugin({ key: "custom" });
    const pluginKeys = createEditorKit({
      additionalPlugins: [CustomPlugin],
      excludePluginKeys: ["p"],
      recipe: "minimal",
    }).map((plugin) => plugin.key);

    expect(pluginKeys).toContain("custom");
    expect(pluginKeys).not.toContain("p");
  });

  it("replaces package plugins without changing their recipe position", () => {
    const OverrideParagraphPlugin = createSlatePlugin({ key: "p" });
    const plugins = createEditorKit({
      overridePlugins: [OverrideParagraphPlugin],
      recipe: "minimal",
    });

    expect(plugins.filter((plugin) => plugin.key === "p")).toEqual([
      OverrideParagraphPlugin,
    ]);
  });

  it("defines every recipe with core editing enabled", () => {
    for (const groups of Object.values(EDITOR_RECIPES)) {
      expect(groups).toContain("core");
    }
  });
});
