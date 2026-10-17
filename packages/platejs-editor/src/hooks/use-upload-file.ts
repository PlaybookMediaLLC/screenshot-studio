import { generateReactHelpers } from "@uploadthing/react";
import React from "react";
import { toast } from "sonner";
import type {
  ClientUploadedFileData,
  UploadFilesOptions,
} from "uploadthing/types";
import { z } from "zod";
import type { OurFileRouter } from "../lib/uploadthing";

const uploadThingOrigin =
  globalThis.location?.origin && globalThis.location.origin !== "null"
    ? globalThis.location.origin
    : "http://localhost:3000";

export const { uploadFiles, useUploadThing } =
  generateReactHelpers<OurFileRouter>({
    url: new URL("/api/uploadthing", uploadThingOrigin),
  });

export interface UploadedFile<T = unknown> extends ClientUploadedFileData<T> {
  key: string;
  name: string;
  size: number;
  type: string;
  url: string;
  appUrl: string;
  ufsUrl: string;
}

interface UseUploadFileProps
  extends Partial<
    Pick<
      UploadFilesOptions<OurFileRouter["editorUploader"]>,
      "headers" | "onUploadBegin" | "onUploadProgress" | "skipPolling"
    >
  > {
  defaultUploadedFiles?: UploadedFile[];
  onUploadComplete?: (file: UploadedFile) => void;
  onUploadError?: (error: unknown) => void;
}

export function useUploadFile({
  onUploadComplete,
  onUploadError,
  ...props
}: UseUploadFileProps = {}) {
  const [uploadedFile, setUploadedFile] = React.useState<UploadedFile>();
  const [uploadingFile, setUploadingFile] = React.useState<File>();
  const [uploadProgress, setUploadProgress] = React.useState<number>(0);
  const [isUploading, setIsUploading] = React.useState(false);

  async function uploadThing(file: File) {
    setIsUploading(true);
    setUploadingFile(file);

    try {
      const res = await uploadFiles("editorUploader", {
        ...props,
        files: [file],
        onUploadProgress: ({ progress: nextProgress }) => {
          setUploadProgress(Math.min(nextProgress, 100));
        },
      });

      const nextUploadedFile = res[0];

      setUploadedFile(nextUploadedFile);
      onUploadComplete?.(nextUploadedFile);

      return nextUploadedFile;
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      const message =
        errorMessage.length > 0
          ? errorMessage
          : "Something went wrong, please try again later.";

      toast.error(message);

      onUploadError?.(error);

      // Mock upload for unauthenticated users
      // toast.info('User not logged in. Mocking upload process.');
      const mockUploadedFile = {
        key: "mock-key-0",
        appUrl: `https://mock-app-url.com/${file.name}`,
        name: file.name,
        size: file.size,
        type: file.type,
        url: URL.createObjectURL(file),
      } as UploadedFile;

      // Simulate upload progress
      let simulatedProgress = 0;

      const simulateProgress = async () => {
        while (simulatedProgress < 100) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          simulatedProgress += 2;
          setUploadProgress(Math.min(simulatedProgress, 100));
        }
      };

      await simulateProgress();

      setUploadedFile(mockUploadedFile);

      return mockUploadedFile;
    } finally {
      setUploadProgress(0);
      setIsUploading(false);
      setUploadingFile(undefined);
    }
  }

  return {
    isUploading,
    progress: uploadProgress,
    uploadedFile,
    uploadFile: uploadThing,
    uploadingFile,
  };
}

export function getErrorMessage(err: unknown) {
  const unknownError = "Something went wrong, please try again later.";

  if (err instanceof z.ZodError) {
    const errors = err.issues.map((issue) => issue.message);

    return errors.join("\n");
  }
  if (err instanceof Error) {
    return err.message;
  }
  // else if (isRedirectError(err)) {
  //   throw err;
  // }

  return unknownError;
}

export function showErrorToast(err: unknown) {
  const errorMessage = getErrorMessage(err);

  return toast.error(errorMessage);
}
