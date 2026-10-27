import { ElementApi, NodeApi, type TElement, type Value } from "platejs";

const HEADING_TYPE = /^h([1-6])$/;

export type CopilotContext = {
  current: TElement;
  headingPath: string[];
  next?: TElement;
  previous?: TElement;
  title?: string;
};

const elementAt = (value: Value, index: number): TElement | undefined => {
  const node = value[index];
  return node && ElementApi.isElement(node) ? node : undefined;
};

const getTitle = (value: Value): string | undefined => {
  for (const node of value) {
    if (ElementApi.isElement(node) && node.type === "h1") {
      return NodeApi.string(node).trim() || undefined;
    }
  }
};

const getHeadingPath = (value: Value, currentIndex: number): string[] => {
  const headings: string[] = [];
  for (const node of value.slice(0, currentIndex + 1)) {
    if (!ElementApi.isElement(node) || typeof node.type !== "string") continue;

    const match = HEADING_TYPE.exec(node.type);
    if (!match) continue;

    const level = Number(match[1]);
    headings[level - 1] = NodeApi.string(node).trim();
    headings.length = level;
  }
  return headings.filter(Boolean);
};

export const getCopilotContext = (
  value: Value,
  currentIndex: number
): CopilotContext | null => {
  const current = elementAt(value, currentIndex);
  if (!current) return null;

  return {
    current,
    headingPath: getHeadingPath(value, currentIndex),
    next: elementAt(value, currentIndex + 1),
    previous: elementAt(value, currentIndex - 1),
    title: getTitle(value),
  };
};
