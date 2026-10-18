import { describe, expect, test } from "../../test/bun-test-compat";

import { MarkdownJoiner } from "./markdown-streaming";

const runJoiner = (chunks: string[]): string => {
  const joiner = new MarkdownJoiner();
  let output = "";

  for (const chunk of chunks) {
    output += joiner.processText(chunk);
  }

  output += joiner.flush();

  return output;
};

describe("MarkdownJoiner", () => {
  test("streams code fences without language", () => {
    const output = runJoiner([
      "```",
      "\n",
      "const a = 1;\n",
      "```\n",
      "after\n",
    ]);

    expect(output).toBe("```\nconst a = 1;\n```\nafter\n");
  });

  test("ends code blocks with closing fences that include trailing whitespace", () => {
    const output = runJoiner([
      "```ts\n",
      "console.log('hi');\n",
      "```   \n",
      "done\n",
    ]);

    expect(output).toBe("```ts\nconsole.log('hi');\n```   \ndone\n");
  });

  test("buffers markdown links until complete", () => {
    const output = runJoiner(["[text]", "(https://example.com)"]);

    expect(output).toBe("[text](https://example.com)");
  });
});
