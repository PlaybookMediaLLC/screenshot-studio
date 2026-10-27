import type { TextStreamPart, ToolSet } from "ai";

const BOLD_PATTERN = /\*\*.*?\*\*/;
const CODE_FENCE_END_LINE_PATTERN = /^`{3,}$/;
const CODE_FENCE_LINE_PATTERN = /^`{3,}/;
const DIGIT_PATTERN = /^[0-9]$/;
const LINK_PATTERN = /^\[.*?\]\(.*?\)$/;
const MDX_TAG_PATTERN = /<([A-Za-z][A-Za-z0-9\-_]*)>/;
const ORDERED_LIST_PATTERN = /^\d+\.\s+.+/;
const TODO_LIST_PATTERN = /^[*-]\s+\[[ xX]\]\s+.+/;
const UNORDERED_LIST_PATTERN = /^[*-]\s+.+/;

/**
 * Text delta chunk from AI SDK v5's TextStreamPart union.
 * Used for type-safe access to text-delta properties.
 */
type TextDeltaChunk = {
  type: "text-delta";
  id: string;
  text: string;
  providerMetadata?: unknown;
};

function isTextDeltaChunk<TOOLS extends ToolSet>(
  chunk: TextStreamPart<TOOLS>
): chunk is TextStreamPart<TOOLS> & TextDeltaChunk {
  return chunk.type === "text-delta";
}

/**
 * Transform chunks like [**,bold,**] to [**bold**] make the md deserializer
 * happy.
 *
 * @experimental
 */
export const markdownJoinerTransform = <TOOLS extends ToolSet>() => {
  return (_options: { tools: TOOLS; stopStream: () => void }) => {
    const joiner = new MarkdownJoiner();

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      flush(controller) {
        const remaining = joiner.flush();

        if (remaining) {
          controller.enqueue({
            id: crypto.randomUUID(),
            text: remaining,
            type: "text-delta",
          } as TextStreamPart<TOOLS>);
        }
      },
      async transform(chunk, controller) {
        if (isTextDeltaChunk(chunk)) {
          const processedText = joiner.processText(chunk.text);

          // Only enqueue if we have actual text to send
          // Empty string is valid when buffering markdown syntax
          if (processedText !== "") {
            controller.enqueue({
              ...chunk,
              text: processedText,
            } as TextStreamPart<TOOLS>);
            await delay(joiner.delayInMs);
          }
        } else {
          controller.enqueue(chunk);
        }
      },
    });
  };
};

const DEFAULT_DELAY_IN_MS = 10;
const NEST_BLOCK_DELAY_IN_MS = 100;

export class MarkdownJoiner {
  private buffer = "";
  private isBuffering = false;
  private streamingCodeBlock = false;
  private streamingTable = false;
  delayInMs = DEFAULT_DELAY_IN_MS;

  private clearBuffer(): void {
    this.buffer = "";
    this.isBuffering = false;
  }
  private isCompleteBold(): boolean {
    return BOLD_PATTERN.test(this.buffer);
  }

  private isCodeFenceLine(line: string): boolean {
    return CODE_FENCE_LINE_PATTERN.test(line.trimStart());
  }

  private isCodeFenceEndLine(line: string): boolean {
    return CODE_FENCE_END_LINE_PATTERN.test(line.trim());
  }

  private isCompleteLink(): boolean {
    return LINK_PATTERN.test(this.buffer);
  }

  private isCompleteList(): boolean {
    if (UNORDERED_LIST_PATTERN.test(this.buffer) && this.buffer.includes("[")) {
      return TODO_LIST_PATTERN.test(this.buffer);
    }

    return (
      UNORDERED_LIST_PATTERN.test(this.buffer) ||
      ORDERED_LIST_PATTERN.test(this.buffer) ||
      TODO_LIST_PATTERN.test(this.buffer)
    );
  }

  private isCompleteMdxTag(): boolean {
    return MDX_TAG_PATTERN.test(this.buffer);
  }

  private isCompleteTableStart(): boolean {
    return this.buffer.startsWith("|") && this.buffer.endsWith("|");
  }

  private isFalsePositive(char: string): boolean {
    // when link is not complete, even if ths buffer is more than 30 characters, it is not a false positive
    if (this.buffer.startsWith("[") && this.buffer.includes("http")) {
      return false;
    }

    return char === "\n" || this.buffer.length > 30;
  }

  private isListStartChar(char: string): boolean {
    return char === "-" || char === "*" || DIGIT_PATTERN.test(char);
  }

  private isTableEnded(): boolean {
    // Table has ended when we have buffered content without pipe characters
    // This indicates we've moved past the table structure
    return this.buffer.length > 0 && !this.buffer.includes("|");
  }

  flush(): string {
    const remaining = this.buffer;
    this.clearBuffer();

    return remaining;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The streaming parser intentionally models markdown state transitions in one pass to preserve token ordering.
  processText(text: string): string {
    let output = "";

    for (const char of text) {
      if (this.streamingCodeBlock) {
        this.buffer += char;

        if (char === "\n") {
          const line = this.buffer;

          output += line;

          const isEnd = this.isCodeFenceEndLine(line);

          this.clearBuffer();

          if (isEnd) {
            this.streamingCodeBlock = false;
            this.delayInMs = DEFAULT_DELAY_IN_MS;
          }
        }

        continue;
      }

      if (this.streamingTable) {
        this.buffer += char;

        if (char === "\n") {
          output += this.buffer;
          this.clearBuffer();
        }
        if (this.isTableEnded()) {
          this.streamingTable = false;
          this.delayInMs = DEFAULT_DELAY_IN_MS;

          output += this.buffer;
          this.clearBuffer();
        }

        continue;
      }

      if (this.isBuffering) {
        this.buffer += char;

        if (char === "\n" && this.isCodeFenceLine(this.buffer)) {
          this.delayInMs = NEST_BLOCK_DELAY_IN_MS;
          this.streamingCodeBlock = true;

          output += this.buffer;
          this.clearBuffer();

          continue;
        }
        if (this.isCompleteTableStart()) {
          this.delayInMs = NEST_BLOCK_DELAY_IN_MS;
          this.streamingTable = true;

          continue;
        }
        if (
          this.isCompleteBold() ||
          this.isCompleteMdxTag() ||
          this.isCompleteList() ||
          this.isCompleteLink()
        ) {
          output += this.buffer;
          this.clearBuffer();
        } else if (this.isFalsePositive(char)) {
          // False positive - flush buffer as raw text
          output += this.buffer;
          this.clearBuffer();
        }
      } else if (
        char === "*" ||
        char === "<" ||
        char === "`" ||
        char === "|" ||
        char === "[" ||
        this.isListStartChar(char)
      ) {
        // Check if we should start buffering
        this.buffer = char;
        this.isBuffering = true;
      } else {
        // Pass through character directly
        output += char;
      }
    }

    return output;
  }
}

function delay(delayInMs?: number | null): Promise<void> {
  return delayInMs == null
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, delayInMs));
}
