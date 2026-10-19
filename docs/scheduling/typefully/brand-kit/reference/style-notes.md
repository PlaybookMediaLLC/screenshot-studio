# Observed style reference

## Typography and layout

The computed UI font stack begins with Inter, followed by Apple/system and Helvetica fallbacks. Body was 16px / 24px at weight 400; many app controls use smaller tokens. A computed stack does not establish which font rendered each glyph.

Text token sizes: 11.5, 12.5, 13.5, 14, 14.5, 16, 17, 18, 20, 22, 24, 30 and 40px. Weights: 400, 500, 600, 700 and 800. Base spacing unit: .25rem. Radius tokens: .1, .2, .4, .6, .75 and .9rem. Desktop breakpoint token: 680px. Default transition: 150ms, cubic-bezier(.4,0,.2,1). These are tokens, not proof of every component's layout behavior.

## Colors

Primary semantic accent: hsl(205 92% 53%), approximately #199AF5. Live button background was rgb(25,154,245). Main light surfaces are white and slightly blue/gray neutrals. See tokens.json for exact HSL values, all gray steps, semantic states, tags and provider palettes. Provider colors are distinct from Typefully's own accent. Logo gradients are in the original artwork and should not be inferred from the UI accent.

## Live light-mode components

| Component | Measurements |
|---|---|
| Analyze navigation, selected | 13.5px / 17.55px, weight 500; height 28px; radius 6.4px; reported padding 14px 10px; gap 3px. Reported padding and height depend on the app layout/cascade; not a standalone recipe. |
| Followers card | White; radius 12px; padding 12px; top/side border rgb(230,232,234), bottom rgb(199,205,209); subtle two-layer shadow. |
| Metric heading | 18px / 26.1px, weight 600. |
| Share button | 13.5px / 17.55px, weight 500; height 26px; padding 0 10px; radius 9.6px; transparent background. |
| Create-team modal | Width 440px; padding 20px; radius 16px; white; shadows 0 6px 16px -2px rgba(0,0,0,.08) and 0 16px 80px -8px rgba(0,0,0,.1). |
| Modal heading | 18px / 23.4px, weight 600. |
| Team-name input | Height 32px; width 400px; padding 8px 12px; radius 9.6px; 14px / 20px, weight 400; 1px rgb(238,240,241) border. |
| Primary button (disabled observed) | Height 32px; width 200px; padding 0 12px; radius 12px; 14px / 18.2px, weight 600; white text on rgb(25,154,245); opacity .5. Enabled example removes this opacity by inference. |

No team was created and no account preference was changed during inspection.
