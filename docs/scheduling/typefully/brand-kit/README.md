# Typefully CSS and brand asset reference

Captured 13 October 2026 from the live Typefully app and official press kit.

## Contents

- `logos/`: the 13 official PNG and SVG originals, unchanged, including glyph, gradient, flat, transparent, white, rounded-frame, logotype and poster variants.
- `css/original/`: six unchanged loaded stylesheets (five app chunks and Google Fonts declarations).
- `fonts/`: one loaded GT America Standard Medium WOFF2 font.
- `css/tokens.css`: extracted token values with a simplified cascade and explicit dark-mode selector.
- `css/components.css`: reconstructed CSS examples based on live computed styles.
- `reference/tokens.json`: machine-readable theme, semantic light and dark declarations.
- `reference/asset-manifest.json`: source URLs, sizes, logo dimensions and SHA-256 hashes.
- `reference/style-notes.md`: typography, layout and component measurements.
- `style-guide.html`: local visual reference; open it in a browser.

## Sources and scope

Official press kit: https://typefully.notion.site/Brand-Assets-68774421815c49368c0967578f1616ae

App inspected: https://typefully.com/grow

The official press kit supplies logo artwork. A formal brand manual specifying color values, typography, clear space or minimum logo sizes was not found there. UI tokens and component examples in this package are extracted or derived references, not an official design-system release.

CSS is a snapshot of assets loaded on Analyze. It is not the full application source or an exhaustive export of every route. Raw CSS keeps its original URLs and dependencies. Google font declarations reference online font files; Inter and Roboto font binaries are not included. The HTML guide uses local system fallbacks when Inter is unavailable. GT America appears in the app's Twitter-preview font stack; do not infer that it is the primary UI or logo font.

Dark tokens were read from the stylesheet, not tested by changing the user's theme. Derived tokens omit conditional modern-color overrides and simplify original cascade behavior. Reconstructed components reflect the observed light-mode state, not every interaction, viewport or validation state.

Original assets retain their owners' rights. No logo or font reuse license is supplied by this package.
