---
name: add-brand-kit-capability
description: Add or change a Screenshot Studio versioned brand-kit capability. Use for colors, typography tokens, logos, layout defaults, tone rules, copy constraints, visual templates, brand-kit import, artifact rendering, or brand validation.
---

# Add Brand Kit Capability

Read RFC 002, RFC 006, and RFC 007. A brand kit is tenant-owned, versioned
configuration that guides artifacts; it is not a global theme.

## Versioning rules

1. Define a validated compact token schema. Store color values, CSS font-family
   tokens, logo asset IDs, layout defaults, tone, approved names, and required
   copy only when each has a product use.
2. Resolve the organization on the server and require the matching brand role.
3. Draft versions may change. Published versions are immutable and create a new
   version on edit.
4. Pin brand-kit version and template version to every artifact. Never restyle
   an approved or scheduled artifact in place.

## Asset and generation rules

- Keep logos in private tenant R2 storage and validate type, ownership, size,
  and safe decode before use.
- Do not store unlicensed font binaries in the MVP. Store a permitted CSS
  family token or add explicit licensed-font handling later.
- Treat tone rules as constrained guidance, not permission to invent claims.
- Validate contrast, required legal language, approved host names, and missing
  alt text before review.

## Verification

- Test cross-organization asset IDs, published-version edits, regeneration,
  artifact lineage, contrast warnings, and rollback to a prior version.
