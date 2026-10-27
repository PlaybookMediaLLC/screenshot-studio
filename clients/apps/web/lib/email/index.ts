/**
 * Email package public surface.
 *
 * Callers import from `@/lib/email` rather than reaching into individual
 * modules, so the internal split between rendering, batching, and
 * transport can change without touching call sites.
 *
 * Templates are intentionally not re-exported here. They are `.tsx` and
 * pull React into any module that imports this barrel, which would drag
 * the component runtime into job and route code that only needs to send.
 * Import a template from `@/lib/email/templates/<name>` directly.
 */

export { chunk, RESEND_BATCH_LIMIT } from './batching'
export { type RenderedEmail, renderTemplate } from './render'
export {
  type BulkRecipient,
  type DeliveryResult,
  getUnsubscribeHeaders,
  type OutboundEmail,
  type SendBulkInput,
  type SendEmailInput,
  sendBulkEmail,
  sendEmail,
} from './send'
