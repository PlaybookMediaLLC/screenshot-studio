import type { DesignDocument } from '@/lib/design/document'
import type { StageCapture, StageOutput } from './capture'

/** Messages between the editor and its render frame (`/render/local`). Same origin only. */
export type RenderRequest =
  | {
      type: 'render'
      id: string
      document: DesignDocument
      output: StageOutput
      /** Timeline position in milliseconds. */
      time?: number
      /** Keep the document drawn for printing instead of capturing it (print frames only). */
      hold?: boolean
      /** With `hold`: draw a flattened image instead of live layers, as redactions require. */
      raster?: boolean
    }
  | { type: 'cancel'; id: string }

export type RenderResponse =
  | { type: 'ready' }
  | ({ type: 'result'; id: string } & StageCapture)
  | { type: 'error'; id: string; message: string }
  /** A held document is drawn and stays on screen. */
  | { type: 'drawn'; id: string }

export const RENDER_FRAME_PATH = '/render/local'
