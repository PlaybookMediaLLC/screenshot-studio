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
    }
  | { type: 'cancel'; id: string }

export type RenderResponse =
  | { type: 'ready' }
  | ({ type: 'result'; id: string } & StageCapture)
  | { type: 'error'; id: string; message: string }

export const RENDER_FRAME_PATH = '/render/local'
