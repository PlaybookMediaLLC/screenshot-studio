// Module hooks registered by setup.ts; see the comment there.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// `importDocx` is browser-only and passes mammoth an ArrayBuffer, which only
// mammoth's browser bundle accepts; the upstream Bun test mocked it the same way.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "mammoth")
    return nextResolve("mammoth/mammoth.browser.js", context);
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css"))
    return { format: "module", shortCircuit: true, source: "" };
  if (/\/node_modules\/lodash\/lodash\.js$/.test(url)) {
    const path = fileURLToPath(url);
    const names = Object.keys(require(path)).filter((name) =>
      /^[A-Za-z_$][\w$]*$/.test(name)
    );
    const source = [
      `import { createRequire } from 'node:module'`,
      `const lodash = createRequire(import.meta.url)(${JSON.stringify(path)})`,
      `export default lodash`,
      `export const { ${names.join(", ")} } = lodash`,
    ].join("\n");
    return { format: "module", shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
