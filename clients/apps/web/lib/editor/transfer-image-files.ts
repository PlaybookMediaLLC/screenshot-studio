/** Capture files synchronously: browsers clear the transfer after the event returns. */
export function transferImageFiles(data: Pick<DataTransfer, 'files'> | null): File[] {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'))
}
