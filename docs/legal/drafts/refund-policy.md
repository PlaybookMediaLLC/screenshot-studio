# Refund and Cancellation Policy (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no refund policy
> today. The pricing page says "Change plans or cancel any time from the billing portal." Code
> baseline: commit `bad06b3e`.

## Summary

- Cancellation takes effect at the end of the paid period. This matches the billing portal setting.
- The owner must choose a refund rule. Three options are below.
- Auto-renewal laws in some US states require clear terms before purchase and an easy way to
  cancel online.

## Facts from the code

| Topic           | Behavior                                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| Billing         | Stripe Checkout, monthly or annual subscriptions                                |
| Renewal         | Stripe subscriptions renew automatically                                        |
| Cancellation    | Billing portal, at the end of the period                                        |
| Plan changes    | Billing portal, prorated                                                        |
| Failed payment  | 14-day grace, then plan features close                                          |
| Credit packs    | One-time payment; credits do not expire                                         |
| Promotion codes | Allowed in Checkout                                                             |
| Trials          | No trial in Checkout                                                            |
| Taxes           | No automatic tax setting in the Checkout code `[[CONFIRM: Stripe Tax setting]]` |

## Refund options for the owner

1. **No refunds** except where the law requires them. Simple. Clear at checkout.
2. **First-payment window.** A full refund within `[[DAYS]]` days of the first subscription payment.
3. **Annual pro rata.** A pro rata refund of unused months when an annual plan is cancelled.

---

## Proposed text

**Refund and Cancellation Policy**

Version `[[VERSION]]`. Effective `[[EFFECTIVE DATE]]`.

### 1. Cancel

A workspace admin can cancel at any time in the billing portal. The plan stays active until the end
of the paid period. Then plan features close. We do not charge again.

### 2. Renewal

Plans renew automatically. We show the renewal price and date before you pay. `[[COUNSEL: confirm renewal reminder duties for annual plans]]`

### 3. Refunds

`[[REFUND TERMS: insert the option that the owner chooses]]`

### 4. Credit packs

Credit packs are `[[REFUNDABLE OR NON-REFUNDABLE]]`. Credits have no cash value.

### 5. Enterprise

The order form sets the refund and cancellation terms for Enterprise plans.

### 6. Your legal rights

This policy does not limit rights that the law gives you.

### 7. Contact

Billing questions: `[[SUPPORT EMAIL]]`.
