import { resolve } from "node:path";

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // The signed-in app's 80% zoom; see postcss-app-zoom.cjs. An absolute
    // path, because Turbopack resolves plugin names from its own build chunks.
    [resolve(process.cwd(), "postcss-app-zoom.cjs")]: {},
  },
};

export default config;
