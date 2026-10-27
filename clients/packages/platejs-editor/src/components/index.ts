/* biome-ignore-all lint/performance/noBarrelFile: this file intentionally defines the components public API surface. */
// Editor Kits

export {
  ComposerEditor,
  type ComposerEditorProps,
  type ComposerMentionUser,
  type ComposerSlashGroup,
  type ComposerSlashItem,
} from "./composer-editor";
export {
  ComposerEditorKit,
  type ComposerVariant,
  getComposerEditorPlugins,
} from "./composer-kit";
export { BaseEditorKit } from "./editor-base-kit";
export {
  createEditorKit,
  type CreateEditorKitOptions,
  EDITOR_RECIPES,
  type EditorFeatureGroup,
  type EditorKitPlugin,
  type EditorRecipe,
} from "./create-editor-kit";
export { EditorKit, type MyEditor, useEditor } from "./editor-kit";

// Plate Editor
export { PlateEditor } from "./plate-editor";
// Types
export * from "./plate-types";
// Transforms
export {
  getBlockType,
  insertBlock,
  insertInlineElement,
  setBlockType,
} from "./transforms";
// Hooks
export { useChat } from "./use-chat";
