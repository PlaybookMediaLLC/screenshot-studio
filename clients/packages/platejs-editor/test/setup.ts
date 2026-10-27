/**
 * Node test setup for the vendored package. Bun, which the upstream tests ran
 * on, loads things Node does not:
 *
 * - CSS imports: `@platejs/math` imports KaTeX's stylesheet. Tests need no
 *   styles, so a stylesheet loads as an empty module.
 * - Named ESM imports from `lodash`: `@platejs/docx-io` does
 *   `import { cloneDeep } from "lodash"`, and Node cannot see lodash's
 *   CommonJS exports. The hook re-exports them by name.
 * - `mammoth` resolves to its browser bundle, as the upstream test mocked it.
 *
 * Bundlers (Next.js) handle all three, so this is test-only.
 */
import Module, { register } from "node:module";

type Loader = (module: { exports: unknown }) => void;
(Module as unknown as { _extensions: Record<string, Loader> })._extensions[
  ".css"
] = (module) => {
  module.exports = {};
};

register("./esm-hooks.mjs", import.meta.url);
