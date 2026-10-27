import type { AnySlatePlugin } from "platejs";
import { TrailingBlockPlugin } from "platejs";
import type { AnyPlatePlugin } from "platejs/react";

import { AIKit } from "../plugins/ai-kit";
import { AlignKit } from "../plugins/align-kit";
import { AutoformatKit } from "../plugins/autoformat-kit";
import { BasicBlocksKit } from "../plugins/basic-blocks-kit";
import { BasicMarksKit } from "../plugins/basic-marks-kit";
import { BlockMenuKit } from "../plugins/block-menu-kit";
import { BlockPlaceholderKit } from "../plugins/block-placeholder-kit";
import { CalloutKit } from "../plugins/callout-kit";
import { CodeBlockKit } from "../plugins/code-block-kit";
import { ColumnKit } from "../plugins/column-kit";
import { CommentKit } from "../plugins/comment-kit";
import { CopilotKit } from "../plugins/copilot-kit";
import { CursorOverlayKit } from "../plugins/cursor-overlay-kit";
import { CsvKit } from "../plugins/csv-kit";
import { DateKit } from "../plugins/date-kit";
import { DiscussionKit } from "../plugins/discussion-kit";
import { DndKit } from "../plugins/dnd-kit";
import { DocxKit } from "../plugins/docx-kit";
import { EmojiKit } from "../plugins/emoji-kit";
import { ExitBreakKit } from "../plugins/exit-break-kit";
import { FindReplaceKit } from "../plugins/find-replace-kit";
import { FloatingToolbarKit } from "../plugins/floating-toolbar-kit";
import { FontKit } from "../plugins/font-kit";
import { FootnoteKit } from "../plugins/footnote-kit";
import { LinkKit } from "../plugins/link-kit";
import { LineHeightKit } from "../plugins/line-height-kit";
import { ListKit } from "../plugins/list-kit";
import { MarkdownKit } from "../plugins/markdown-kit";
import { MathKit } from "../plugins/math-kit";
import { MediaKit } from "../plugins/media-kit";
import { MentionKit } from "../plugins/mention-kit";
import { SlashKit } from "../plugins/slash-kit";
import { SuggestionKit } from "../plugins/suggestion-kit";
import { TableKit } from "../plugins/table-kit";
import { TabbableKit } from "../plugins/tabbable-kit";
import { TextIndentKit } from "../plugins/text-indent-kit";
import { TocKit } from "../plugins/toc-kit";
import { ToggleKit } from "../plugins/toggle-kit";

export type EditorFeatureGroup =
  | "advanced"
  | "ai"
  | "collaboration"
  | "core"
  | "media";

export const EDITOR_RECIPES = {
  collaborative: ["core", "media", "collaboration", "advanced"],
  full: ["core", "ai", "media", "collaboration", "advanced"],
  minimal: ["core"],
  writing: ["core", "media", "advanced"],
} as const satisfies Record<string, readonly EditorFeatureGroup[]>;

export type EditorRecipe = keyof typeof EDITOR_RECIPES;
export type EditorKitPlugin = AnyPlatePlugin | AnySlatePlugin;

export interface CreateEditorKitOptions {
  additionalPlugins?: readonly EditorKitPlugin[];
  excludePluginKeys?: readonly string[];
  overridePlugins?: readonly EditorKitPlugin[];
  recipe?: EditorRecipe;
}

type EditorKitEntry = readonly [
  group: EditorFeatureGroup,
  plugins: readonly EditorKitPlugin[],
];

const EDITOR_KIT_ENTRIES: readonly EditorKitEntry[] = [
  ["ai", CopilotKit],
  ["ai", AIKit],
  ["advanced", BlockMenuKit],
  ["core", BasicBlocksKit],
  ["advanced", CodeBlockKit],
  ["advanced", TableKit],
  ["core", ToggleKit],
  ["advanced", TocKit],
  ["media", MediaKit],
  ["core", CalloutKit],
  ["media", ColumnKit],
  ["advanced", MathKit],
  ["advanced", DateKit],
  ["core", LinkKit],
  ["advanced", MentionKit],
  ["core", BasicMarksKit],
  ["core", FontKit],
  ["core", AlignKit],
  ["core", LineHeightKit],
  ["core", TextIndentKit],
  ["core", ListKit],
  ["collaboration", DiscussionKit],
  ["collaboration", CommentKit],
  ["collaboration", SuggestionKit],
  ["advanced", SlashKit],
  ["core", AutoformatKit],
  ["core", FindReplaceKit],
  ["collaboration", CursorOverlayKit],
  ["advanced", DndKit],
  ["media", EmojiKit],
  ["core", ExitBreakKit],
  ["core", [TrailingBlockPlugin]],
  ["advanced", DocxKit],
  ["advanced", CsvKit],
  ["advanced", FootnoteKit],
  ["core", [TabbableKit]],
  ["advanced", MarkdownKit],
  ["advanced", BlockPlaceholderKit],
  ["advanced", FloatingToolbarKit],
];

const createPluginCollector = (excludePluginKeys: readonly string[]) => {
  const excludedKeys = new Set(excludePluginKeys);
  const pluginKeys = new Set<string>();
  const plugins: EditorKitPlugin[] = [];

  const add = (plugin: EditorKitPlugin): void => {
    if (excludedKeys.has(plugin.key) || pluginKeys.has(plugin.key)) return;

    pluginKeys.add(plugin.key);
    plugins.push(plugin);
  };

  return { add, plugins };
};

const getRecipePlugins = (
  recipe: EditorRecipe,
  overridePlugins: readonly EditorKitPlugin[]
): EditorKitPlugin[] => {
  const enabledGroups = new Set<EditorFeatureGroup>(EDITOR_RECIPES[recipe]);
  const overrides = new Map(
    overridePlugins.map((plugin) => [plugin.key, plugin] as const)
  );
  const plugins: EditorKitPlugin[] = [];

  for (const [group, groupPlugins] of EDITOR_KIT_ENTRIES) {
    if (!enabledGroups.has(group)) continue;

    for (const plugin of groupPlugins) {
      plugins.push(overrides.get(plugin.key) ?? plugin);
    }
  }

  return plugins;
};

export const createEditorKit = ({
  additionalPlugins = [],
  excludePluginKeys = [],
  overridePlugins = [],
  recipe = "full",
}: CreateEditorKitOptions = {}): EditorKitPlugin[] => {
  const { add, plugins } = createPluginCollector(excludePluginKeys);

  for (const plugin of [
    ...getRecipePlugins(recipe, overridePlugins),
    ...additionalPlugins,
  ]) {
    add(plugin);
  }

  return plugins;
};
