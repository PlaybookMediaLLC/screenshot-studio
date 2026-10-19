import type { CreativeSetDocument } from './document'
import { mergeSetConcurrent } from './concurrent'

type Entry = { before: CreativeSetDocument; after: CreativeSetDocument }

/** Only document transactions enter history; selection, output choice and zoom do not. */
export class SetHistory {
  private past: Entry[] = []
  private future: Entry[] = []
  constructor(public document: CreativeSetDocument) {}
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  /** Asset upload changes storage references, not the user's undoable intent. */
  normalizeAssets(resolve: (document: CreativeSetDocument) => CreativeSetDocument) {
    this.document = resolve(this.document)
    for (const entry of [...this.past, ...this.future]) {
      entry.before = resolve(entry.before)
      entry.after = resolve(entry.after)
    }
  }
  commit(next: CreativeSetDocument): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.document)) return false
    this.past.push({ before: this.document, after: next })
    if (this.past.length > 100) this.past.shift()
    this.future = []
    this.document = next
    return true
  }
  undo() {
    const entry = this.past.at(-1)
    if (entry) {
      const next = mergeSetConcurrent(entry.after, entry.before, this.document)
      this.past.pop()
      this.future.push(entry)
      this.document = next
    }
    return this.document
  }
  redo() {
    const entry = this.future.at(-1)
    if (entry) {
      const next = mergeSetConcurrent(entry.before, entry.after, this.document)
      this.future.pop()
      this.past.push(entry)
      this.document = next
    }
    return this.document
  }
}
