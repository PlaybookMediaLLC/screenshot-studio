export const downloadFile = async (url: string, filename: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("downloadFile can only be used in the browser");
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file (HTTP ${response.status})`);
  }

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const link = document.createElement("a");

  try {
    link.href = blobUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  }
};
