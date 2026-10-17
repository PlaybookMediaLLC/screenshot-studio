import type { Descendant } from "platejs";

import type { EditorUploadFile } from "./editor-services";

type MediaNode = {
  assetId?: string;
  children?: Descendant[];
  type?: string;
  url?: string;
};

const isInlineData = (url: unknown): url is string =>
  typeof url === "string" &&
  (url.startsWith("data:") || url.startsWith("blob:"));

/**
 * Uploads every image whose `url` is inline data (as DOCX import and pasted
 * HTML produce) through the host's upload service, and returns a copy of the
 * value that points at the stored files instead. A document saved with a
 * `data:` or `blob:` URL would be huge, or break for every other reader.
 */
export async function rehostDataImages<T extends Descendant[]>(
  value: T,
  uploadFile: EditorUploadFile
): Promise<T> {
  let index = 0;
  const visit = async (node: Descendant): Promise<Descendant> => {
    const media = node as MediaNode;
    const children = media.children
      ? await Promise.all(media.children.map(visit))
      : undefined;
    const next = (children ? { ...node, children } : { ...node }) as MediaNode;
    if (media.type !== "img" || !isInlineData(media.url))
      return next as Descendant;
    const blob = await (await fetch(media.url)).blob();
    index += 1;
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const file = new File([blob], `imported-image-${index}.${extension}`, {
      type: blob.type,
    });
    const stored = await uploadFile(file);
    return {
      ...next,
      url: stored.url,
      ...(stored.assetId ? { assetId: stored.assetId } : {}),
    } as Descendant;
  };
  return (await Promise.all(value.map(visit))) as T;
}
