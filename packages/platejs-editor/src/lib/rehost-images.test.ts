import { expect, test } from "../../test/bun-test-compat";
import { rehostDataImages } from "./rehost-images";

test("re-uploads inline images and leaves stored ones alone", async () => {
  const uploaded: File[] = [];
  const value = [
    { type: "p", children: [{ text: "intro" }] },
    {
      type: "img",
      url: "data:image/png;base64,iVBORw0KGgo=",
      children: [{ text: "" }],
    },
    {
      type: "img",
      url: "https://cdn.example/kept.png",
      children: [{ text: "" }],
    },
    {
      type: "column_group",
      children: [
        {
          type: "img",
          url: "data:image/jpeg;base64,/9j/4A==",
          children: [{ text: "" }],
        },
      ],
    },
  ];

  const result = await rehostDataImages(value, async (file) => {
    uploaded.push(file);
    return {
      assetId: `asset-${uploaded.length}`,
      name: file.name,
      size: file.size,
      type: file.type,
      url: `/stored/${uploaded.length}`,
    };
  });

  expect(uploaded.map((file) => file.type)).toEqual([
    "image/png",
    "image/jpeg",
  ]);
  expect(JSON.stringify(result)).not.toContain("data:");
  expect(JSON.stringify(result)).toContain("https://cdn.example/kept.png");
  expect(JSON.stringify(result)).toContain('"assetId":"asset-2"');
  expect(JSON.stringify(value)).toContain("data:image/png");
});
