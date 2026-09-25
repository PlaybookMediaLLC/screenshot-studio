import test from "node:test";
import assert from "node:assert/strict";
import { useImageStore } from "../lib/store";

const initialState = useImageStore.getInitialState();

test("overlay selection stays outside undo history and cannot target deleted images", () => {
  useImageStore.setState(initialState, true);
  const store = useImageStore.getState();
  const history = useImageStore.temporal.getState();
  useImageStore.setState({ uploadedImageUrl: "data:image/png;base64,main" });
  store.addImageOverlay({
    src: "data:image/png;base64,overlay",
    position: { x: 100, y: 100 }, size: 150, rotation: 0, opacity: 1,
    flipX: false, flipY: false, isVisible: true, isCustom: true,
  });
  const id = useImageStore.getState().imageOverlays[0].id;
  history.clear();

  store.setIsMainImageSelected(true);
  store.setSelectedOverlayId(id);
  assert.equal(useImageStore.getState().isMainImageSelected, false);
  assert.equal(useImageStore.temporal.getState().pastStates.length, 0);

  store.updateImageOverlay(id, { size: 250 });
  store.setSelectedOverlayId(null);
  assert.equal(useImageStore.getState().isMainImageSelected, false);
  history.undo();
  assert.equal(useImageStore.getState().imageOverlays[0].size, 150);
  assert.equal(useImageStore.getState().selectedOverlayId, null);
  store.setSelectedOverlayId(id);
  assert.equal(useImageStore.temporal.getState().futureStates.length, 1);
  history.redo();
  assert.equal(useImageStore.getState().imageOverlays[0].size, 250);
  assert.equal(useImageStore.getState().imageScale, 100);

  history.clear();
  store.removeImageOverlay(id);
  assert.equal(useImageStore.getState().selectedOverlayId, null);
  assert.equal(useImageStore.getState().isMainImageSelected, false);
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1);
  history.undo();
  assert.equal(useImageStore.getState().imageOverlays[0].id, id);
  store.setSelectedOverlayId(id);
  history.redo();
  assert.equal(useImageStore.getState().selectedOverlayId, null);

  history.undo();
  store.setSelectedOverlayId(id);
  store.clearImageOverlays();
  assert.equal(useImageStore.getState().selectedOverlayId, null);
  store.setIsMainImageSelected(true);
  store.clearImage();
  assert.equal(useImageStore.getState().isMainImageSelected, false);
  useImageStore.setState(initialState, true);
  history.clear();
});
