# Legal document drafts

> **DRAFT — requires counsel review.** Nothing in this directory is legal advice, and
> nothing here is published. The live pages stay as they are until the owner signs off.

These drafts replace or add to the public legal pages:

- `app/[locale]/terms/page.tsx`
- `app/[locale]/privacy-policy/page.tsx`
- `components/platform-landing/pages/SecurityPage.tsx`

They come from an audit of the code at commit `70f4951a` (2026-10-17). The audit report, with
evidence for every finding, is shared separately with the owner.

## How to read a draft

Each draft has:

1. A banner: **DRAFT — requires counsel review**.
2. A plain-language summary.
3. For documents that already exist, a **redline**: ~~struck text~~ is current wording to remove,
   **bold text** is the replacement, and each change gives its reason.
4. The full proposed text.

Placeholders in `[[DOUBLE BRACKETS]]` stand for facts the code cannot establish: the legal
entity, address, governing law, contacts, signed DPAs, insurance and certifications. Do not
publish a document while it still contains a placeholder.

Notes in `[[PRODUCT: …]]` mark a sentence that is true only after a product change ships. The
audit report lists those changes. Either ship the change or delete the sentence before
publishing.

## Placeholders used

| Placeholder | Meaning |
| --- | --- |
| `[[LEGAL ENTITY]]` | Full legal name of the company that operates Shots |
| `[[ENTITY TYPE AND STATE]]` | For example "a [[STATE]] limited liability company" |
| `[[ADDRESS]]` | Registered or principal business address |
| `[[GOVERNING LAW]]` | Governing law of the Terms |
| `[[VENUE]]` | Courts, or arbitration seat, for disputes |
| `[[DISPUTE MECHANISM]]` | Courts, or arbitration with a class waiver |
| `[[PRIVACY CONTACT]]` | Privacy request mailbox, for example `privacy@…` |
| `[[LEGAL NOTICES EMAIL]]` | Address for legal notices |
| `[[SECURITY CONTACT]]` | Vulnerability report mailbox |
| `[[DMCA AGENT]]` | Name and address of the designated DMCA agent, registered with the US Copyright Office |
| `[[SUPPORT CONTACT]]` | Support mailbox |
| `[[DPO/CONTACT]]` | Data protection officer, if one is appointed |
| `[[EU REPRESENTATIVE]]`, `[[UK REPRESENTATIVE]]` | GDPR Art. 27 representatives, if required |
| `[[EFFECTIVE DATE]]` | Date the document takes effect |
| `[[VERSION]]` | Document version, recorded at acceptance |
| `[[REFUND WINDOW]]` | Refund window the owner chooses, if any |
| `[[LIABILITY CAP]]` | Liability cap counsel sets |
| `[[DPA STATUS: vendor]]` | Whether a DPA or SCCs are signed with that vendor |
| `[[REGION: vendor]]` | Processing region, where the config does not show it |

## Files

| File | Replaces or adds |
| --- | --- |
| `terms-of-service.md` | Replaces `/terms` |
| `privacy-policy.md` | Replaces `/privacy-policy` |
| `security-page-redline.md` | Edits to `/security` and two Enterprise-page lines |
| `cookie-policy.md` | New `/cookies` |
| `subprocessors.md` | New `/subprocessors` |
| `dpa.md` | New `/dpa` |
| `acceptable-use-policy.md` | New `/acceptable-use` |
| `ai-use-policy.md` | New `/ai` |
| `dmca-copyright-policy.md` | New `/copyright` |
| `refund-policy.md` | New `/refunds` |
| `api-terms.md` | New `/api-terms` |
| `responsible-disclosure.md` | New `/security/disclosure` and `/.well-known/security.txt` |
| `sla-support-policy.md` | New `/support` |
