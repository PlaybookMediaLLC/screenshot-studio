# @canvas/platejs-editor

A rich text editor package built on [Plate.js](https://platejs.org/) for Eigenn. Provides a complete Notion-like editing experience with support for AI assistance, block operations, collaboration, and more.

## Installation

This package is part of the Eigenn monorepo. It is automatically available to other packages via workspace dependencies.

```bash
# In package.json of consuming package
{
  "dependencies": {
    "@canvas/platejs-editor": "workspace:*"
  }
}
```

## Usage

### Basic Editor

```tsx
import { EditorKit } from '@canvas/platejs-editor';
import { Editor, EditorContainer } from '@canvas/platejs-editor/ui';
import { Plate, usePlateEditor } from 'platejs/react';

function MyEditor() {
  const editor = usePlateEditor({
    plugins: EditorKit,
  });

  return (
    <Plate editor={editor}>
      <EditorContainer>
        <Editor aria-label="Document editor" placeholder="Start typing..." />
      </EditorContainer>
    </Plate>
  );
}
```

### Custom Configuration

```tsx
import { createEditorKit } from '@canvas/platejs-editor';
import { Editor, EditorContainer } from '@canvas/platejs-editor/ui';
import { Plate, usePlateEditor } from 'platejs/react';

const MinimalEditorKit = createEditorKit({ recipe: 'minimal' });

function MinimalEditor() {
  const editor = usePlateEditor({
    plugins: MinimalEditorKit,
  });

  return (
    <Plate editor={editor}>
      <EditorContainer>
        <Editor aria-label="Document editor" variant="default" />
      </EditorContainer>
    </Plate>
  );
}
```

## Features

- **Block-based editing**: Paragraphs, headings, lists, code blocks, tables, callouts, and more
- **Rich formatting**: Bold, italic, underline, strikethrough, code, links
- **AI integration**: Copilot suggestions and AI chat
- **Media support**: Images, videos, audio, file attachments
- **Collaboration**: Comments, suggestions, real-time cursor overlay
- **Math equations**: LaTeX support via KaTeX
- **Code blocks**: Syntax highlighting with Prism
- **Table of contents**: Auto-generated ToC sidebar
- **Slash commands**: Quick block insertion
- **Drag and drop**: Reorder blocks
- **Markdown support**: Import/export
- **DOCX support**: Import Word documents

## Exports

### Main Entry (`@canvas/platejs-editor`)

- `EditorKit` - Full-featured editor plugin kit
- `createEditorKit` - Canonical recipe and app-override factory
- `BaseEditorKit` - Base kit for static rendering
- `useEditor` - Hook to access editor instance
- `PlateEditor` - Demo editor component

### Components (`@canvas/platejs-editor/components`)

- Editor kit configurations
- Transform utilities
- Type definitions

### Plugins (`@canvas/platejs-editor/plugins`)

All editor plugins including:
- `AIKit`, `CopilotKit`
- `FindReplaceKit`
- `BasicBlocksKit`, `BasicMarksKit`
- `LinkKit`, `ListKit`, `TableKit`
- `MediaKit`, `CommentKit`
- And many more...

### UI (`@canvas/platejs-editor/ui`)

All UI components for:
- Editor container and content
- Block elements (paragraphs, headings, code blocks, etc.)
- Toolbars and menus
- Floating components
- Static rendering components

### Hooks (`@canvas/platejs-editor/hooks`)

- `useCopyToClipboard`
- `useDebounce`, `useDebouncedCallback`
- `useMediaQuery`
- `useMounted`
- `useOnClickOutside`
- `useUploadFile`

### Lib (`@canvas/platejs-editor/lib`)

- `cn` - Class name utility
- `downloadFile` - File download helper

## Customization

### Extending the Editor

You can customize the editor by:

1. **Selecting specific plugins**: Pick only the plugins you need
2. **Overriding components**: Replace UI components with custom implementations
3. **Adding custom plugins**: Create new plugins for specific functionality

### Styling

The package uses Tailwind CSS for styling. Make sure your project includes:

1. Tailwind CSS configuration
2. The required CSS variables for colors
3. The `@canvas/styles` package (or equivalent)

## Plate Registry Integration

This package is configured to work with the [Plate registry](https://platejs.org/docs/components). You can add new components using:

```bash
npx shadcn@latest add https://platejs.org/r/{component-name}
```

### MCP Server Configuration

For AI assistance in development, you can configure the Plate MCP server:

```json
{
  "mcpServers": {
    "plate": {
      "description": "Plate editors, plugins and components",
      "type": "stdio",
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

## Development

### Running TypeScript Check

```bash
bun run --cwd packages/platejs-editor typecheck
```

### Linting

```bash
bun run --cwd packages/platejs-editor lint
```

### Testing

```bash
bun run --cwd packages/platejs-editor test
```

AI, upload, and export route handlers are app-owned security boundaries. Do not
add generic server routes to this package. App routes must authenticate users,
validate request bodies, enforce rate limits, and keep credentials server-side.

## License

Part of the Eigenn project. See repository root for license information.
