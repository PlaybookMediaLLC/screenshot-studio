import type { FileRouter } from "uploadthing/next";

/** Client-only route shape. The authenticated server router belongs to the app. */
export type OurFileRouter = FileRouter & {
  editorUploader: FileRouter[string];
};
