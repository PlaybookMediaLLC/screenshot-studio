import React from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  type EditorUploadedFile,
  useEditorServices,
} from "../lib/editor-services";

export type UploadedFile = EditorUploadedFile;

interface UseUploadFileProps {
  defaultUploadedFiles?: UploadedFile[];
  onUploadComplete?: (file: UploadedFile) => void;
  onUploadError?: (error: unknown) => void;
}

/**
 * Uploads through the host's `uploadFile` service (see `EditorServicesProvider`).
 * A failed upload rejects; it never falls back to a local object URL, which
 * would be saved into the document and break for every other reader.
 */
export function useUploadFile({
  onUploadComplete,
  onUploadError,
}: UseUploadFileProps = {}) {
  const { uploadFile: upload } = useEditorServices();
  const [uploadedFile, setUploadedFile] = React.useState<UploadedFile>();
  const [uploadingFile, setUploadingFile] = React.useState<File>();
  const [uploadProgress, setUploadProgress] = React.useState<number>(0);
  const [isUploading, setIsUploading] = React.useState(false);

  async function uploadFile(file: File) {
    setIsUploading(true);
    setUploadingFile(file);

    try {
      if (!upload) {
        throw new Error("Uploads are not available in this editor.");
      }
      const nextUploadedFile = await upload(file, {
        onProgress: (nextProgress) => {
          setUploadProgress(Math.min(nextProgress, 100));
        },
      });

      setUploadedFile(nextUploadedFile);
      onUploadComplete?.(nextUploadedFile);

      return nextUploadedFile;
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      toast.error(
        errorMessage.length > 0
          ? errorMessage
          : "Something went wrong, please try again later."
      );
      onUploadError?.(error);
      throw error;
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
    uploadFile,
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

  return unknownError;
}

export function showErrorToast(err: unknown) {
  const errorMessage = getErrorMessage(err);

  return toast.error(errorMessage);
}
