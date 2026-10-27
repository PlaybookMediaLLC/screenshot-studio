/* biome-ignore-all lint/performance/noBarrelFile: this file intentionally defines the package public API surface. */
/**
 * @canvas/platejs-editor
 *
 * A rich text editor package built on Plate.js for Eigenn.
 * Provides a complete Notion-like editing experience with support for
 * AI assistance, block operations, collaboration, and more.
 *
 * @example
 * ```tsx
 * import { EditorKit } from '@canvas/platejs-editor';
 * import { Editor, EditorContainer } from '@canvas/platejs-editor/ui';
 * import { Plate, usePlateEditor } from '@canvas/platejs-editor/platejs/react';
 *
 * function MyEditor() {
 *   const editor = usePlateEditor({ plugins: EditorKit });
 *
 *   return (
 *     <Plate editor={editor}>
 *       <EditorContainer>
 *         <Editor aria-label="Document editor" />
 *       </EditorContainer>
 *     </Plate>
 *   );
 * }
 * ```
 */

export * from "./components";
export * from "./hooks";
export * from "./lib";
export * from "./plugins";
// UI Components are available via @canvas/platejs-editor/ui subpath
// Not re-exported here to avoid conflict with platejs Editor type

// Re-export platejs core to ensure single instance across the monorepo
export * from "platejs";
export * from "platejs/static";
// Explicit type re-exports for TypeScript compatibility
export type {
  PlateEditor,
  PlateElementProps,
  PlateLeafProps,
  RenderNodeWrapper,
  TPlateEditor,
} from "platejs/react";
export {
  atom,
  BelowRootNodes,
  BLUR_EDITOR_EVENT,
  BlockPlaceholderPlugin,
  Box,
  ContentVisibilityChunk,
  composeEventHandlers,
  composeRefs,
  convertDomEventToSyntheticEvent,
  createAtomStore,
  createPlateEditor,
  createPlateFallbackEditor,
  createPlatePlugin,
  createPlateStore,
  createPrimitiveComponent,
  createPrimitiveElement,
  createSlotComponent,
  createTPlatePlugin,
  DEFAULT_IGNORE_CLASS,
  DefaultPlaceholder,
  DOM_HANDLERS,
  Editable,
  EditorHotkeysEffect,
  EditorMethodsEffect,
  EditorRefEffect,
  EditorRefPluginEffect,
  ElementProvider,
  EventEditorPlugin,
  EventEditorStore,
  elementStore,
  FOCUS_EDITOR_EVENT,
  GLOBAL_PLATE_SCOPE,
  getEventPlateId,
  getPlateCorePlugins,
  getPlugin,
  getRenderNodeProps,
  HotkeysProvider,
  isEventHandled,
  isHotkeyPressed,
  Key,
  MemoizedChildren,
  ParagraphPlugin,
  PLATE_SCOPE,
  Plate,
  PlateContainer,
  PlateContent,
  PlateController,
  PlateControllerEffect,
  PlateElement,
  PlateLeaf,
  PlateSlate,
  PlateStoreProvider,
  PlateTest,
  PlateText,
  PlateView,
  PortalBody,
  pipeHandler,
  pipeOnChange,
  pipeRenderElement,
  pipeRenderLeaf,
  pipeRenderText,
  plateControllerStore,
  plateStore,
  pluginRenderElement,
  pluginRenderLeaf,
  pluginRenderText,
  ReactPlugin,
  SCOPE_ELEMENT,
  Slate,
  SlateReactExtensionPlugin,
  Text,
  toPlatePlugin,
  toTPlatePlugin,
  useComposedRef,
  useComposing,
  useEditableProps,
  useEditorComposing,
  useEditorContainerRef,
  useEditorId,
  useEditorMounted,
  useEditorPlugin,
  useEditorPluginOption,
  useEditorPluginOptions,
  useEditorReadOnly,
  useEditorRef,
  useEditorScrollRef,
  useEditorSelection,
  useEditorSelector,
  useEditorState,
  useEditorString,
  useEditorValue,
  useEditorVersion,
  useEffectOnce,
  useElement,
  useElementSelector,
  useElementStore,
  useEventEditorValue,
  useEventPlateId,
  useFocusEditorEvents,
  useFocused,
  useFormInputProps,
  useHotkeys,
  useHotkeysContext,
  useIncrementVersion,
  useIsomorphicLayoutEffect,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
  useMemoizedSelector,
  useNodePath,
  useOnClickOutside,
  usePath,
  usePlateControllerExists,
  usePlateControllerLocalStore,
  usePlateControllerStore,
  usePlateEditor,
  usePlateLocalStore,
  usePlateSet,
  usePlateState,
  usePlateStore,
  usePlateValue,
  usePlateViewEditor,
  usePluginOption,
  usePluginOptions,
  useReadOnly,
  useRecordHotkeys,
  useRedecorate,
  useRemoveNodeButton,
  useScrollRef,
  useSelected,
  useSelectionAcrossBlocks,
  useSelectionCollapsed,
  useSelectionExpanded,
  useSelectionFragment,
  useSelectionFragmentProp,
  useSelectionVersion,
  useSelectionWithinBlock,
  useSlateProps,
  useStableFn,
  useStableMemo,
  useStoreAtomState,
  useStoreAtomValue,
  useStoreSelect,
  useStoreSetAtom,
  useStoreState,
  useStoreValue,
  useTracked,
  useTrackedStore,
  useValueVersion,
  withHOC,
  withPlate,
  withPlateReact,
  withProviders,
  withReact,
  withRef,
} from "platejs/react";
