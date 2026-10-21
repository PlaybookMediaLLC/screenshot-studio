import type { DesignDocument } from './document'

/** The shared composition with one slide in its primary frame, ready for a still preview. */
export function slidePreviewDocument(document: DesignDocument, src: string): DesignDocument {
  const screens = document.devices?.mockups ?? []
  const linked = screens.some((screen) => !screen.screen.code && (!screen.screen.src || screen.screen.src === document.image.src))
  const first = screens.findIndex((screen) => !screen.screen.code)
  return {
    ...document,
    image: { ...document.image, src },
    slides: undefined,
    devices: document.devices ? {
      ...document.devices,
      mockups: screens.map((screen, index) => !screen.screen.code &&
        (linked ? !screen.screen.src || screen.screen.src === document.image.src : index === first)
        ? { ...screen, screen: { ...screen.screen, src: null } } : screen),
    } : undefined,
  }
}
