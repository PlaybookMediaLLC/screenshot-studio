import {
  CsvPlugin as BaseCsvPlugin,
  deserializeCsv,
} from "@platejs/csv";

const TRAILING_LINE_BREAKS = /(?:\r?\n)+$/;

export const CsvPlugin = BaseCsvPlugin.configure({
  options: {
    parseOptions: {
      header: true,
      skipEmptyLines: true,
    },
  },
}).extendApi(({ editor }) => ({
  deserialize: (options: Parameters<typeof deserializeCsv>[1]) =>
    deserializeCsv(editor, {
      ...options,
      data: options.data.replace(TRAILING_LINE_BREAKS, ""),
    }),
}));

export const CsvKit = [CsvPlugin];
