import { PRODUCT_FACTS, atLeast } from "@/lib/seo/product-facts";

/** The date every competitor pricing and feature claim on /compare/* was last verified. */
export const CLAIMS_CHECKED = "2026-09-20";

export const CLAIMS_CHECKED_LABEL = new Date(CLAIMS_CHECKED).toLocaleDateString(
  "en-US",
  { year: "numeric", month: "long", day: "numeric" },
);

export interface ComparisonData {
  slug: string;
  competitorName: string;
  competitorUrl: string;
  tagline: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  competitorPricing: string;
  competitorLimitations: string[];
  studioAdvantages: string[];
  features: {
    name: string;
    studio: string;
    competitor: string;
  }[];
  verdict: string;
  faqs: { q: string; a: string }[];
  /**
   * Set where the competitor does a job this product does not, so the page says
   * so up front instead of implying a like-for-like swap.
   */
  scopeNote?: string;
  /**
   * Where the page's calls to action point. Defaults to the editor; a
   * comparison against a single-purpose tool links to our matching tool.
   */
  cta?: { href: string; label: string };
}

export const comparisons: ComparisonData[] = [
  {
    slug: "pika-style",
    competitorName: "Pika Style",
    competitorUrl: "https://pika.style",
    tagline:
      "Screenshot Studio offers more backgrounds, 3D effects, animations, and video export at no cost.",
    metaTitle: "Screenshot Studio vs Pika Style: Free Alternative",
    metaDescription:
      `Compare Screenshot Studio vs Pika Style. Both beautify screenshots, but Screenshot Studio adds 3D effects, animations, video export, and ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds for free. No signup needed.`,
    keywords: [
      "pika style alternative",
      "pika style vs screenshot studio",
      "screenshot studio vs pika",
      "pika style free alternative",
      "pika screenshot editor alternative",
      "better than pika style",
      "pika style competitor",
    ],
    competitorPricing: "Free tier with limits, paid plans from $5/mo",
    competitorLimitations: [
      "Limited free backgrounds",
      "No animation or video export",
      "No 3D perspective effects",
      "Watermark on free tier exports",
      "Requires account for some features",
    ],
    studioAdvantages: [
      `${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds included free`,
      `Full animation timeline with ${atLeast(PRODUCT_FACTS.animationPresets)} presets`,
      "3D perspective transforms",
      "Video export (MP4, WebM, GIF)",
      "No watermarks ever",
      "No signup required",
      "Open source",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "Freemium ($5+/mo)" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, solids, images`, competitor: "Limited free set" },
      { name: "Device Frames", studio: "Safari, Chrome (light/dark), Arc, Polaroid", competitor: "macOS, Windows" },
      { name: "3D Effects", studio: "Full perspective transforms", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframe editor`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Not available" },
      { name: "Text Overlays", studio: `${atLeast(PRODUCT_FACTS.fonts)} fonts, shadows, layers`, competitor: "Basic text" },
      { name: "Image Overlays", studio: "Arrows, stickers, icons", competitor: "Limited" },
      { name: "Export Resolution", studio: "Up to 5x scale", competitor: "Standard" },
      { name: "Watermarks", studio: "Never", competitor: "On free tier" },
      { name: "Signup Required", studio: "No", competitor: "For some features" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      "Screenshot Studio is the stronger choice if you want animations, 3D effects, and video export. Pika Style is simpler but charges for features Screenshot Studio includes for free.",
    faqs: [
      {
        q: "Is Screenshot Studio a good Pika Style alternative?",
        a: `Yes. Screenshot Studio covers all of Pika Style's core features (backgrounds, shadows, device frames) and adds 3D perspective transforms, an animation timeline with ${atLeast(PRODUCT_FACTS.animationPresets)} presets, and video export in MP4, WebM, or GIF. All features are free with no signup.`,
      },
      {
        q: "Does Pika Style offer animation or video export?",
        a: "No. Pika Style focuses on static screenshot beautification. Screenshot Studio includes a full animation timeline with keyframe editing, 20+ motion presets, and exports to MP4, WebM, and GIF formats.",
      },
      {
        q: "Which tool has more backgrounds?",
        a: `Screenshot Studio includes ${atLeast(PRODUCT_FACTS.backgrounds)} gradient, solid, mesh, and custom backgrounds for free. Pika Style offers a smaller set of free backgrounds with more available on paid plans.`,
      },
    ],
  },
  {
    slug: "shots-so",
    competitorName: "Shots.so",
    competitorUrl: "https://shots.so",
    tagline:
      "Get everything Shots.so offers plus animations, 3D effects, and video export, all for free.",
    metaTitle: "Screenshot Studio vs Shots.so: Free Alternative",
    metaDescription:
      `Compare Screenshot Studio vs Shots.so. Screenshot Studio adds 3D effects, animation timeline, video export, text overlays, and ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds. Free, no signup.`,
    keywords: [
      "shots.so alternative",
      "shots so alternative free",
      "screenshot studio vs shots so",
      "shots.so vs screenshot studio",
      "better than shots.so",
      "shots.so free alternative",
      "shots so competitor",
    ],
    competitorPricing: "Free tier with limits, Pro from $5/mo",
    competitorLimitations: [
      "Limited customization on free tier",
      "No animation or video export",
      "No 3D perspective effects",
      "Limited device frame options",
      "Some features behind paywall",
    ],
    studioAdvantages: [
      "All features free, no tiers",
      `Full animation timeline with ${atLeast(PRODUCT_FACTS.animationPresets)} presets`,
      "3D perspective and rotation",
      "Video export in MP4, WebM, GIF",
      "Text and image overlay layers",
      "No account needed",
      "Open source code",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "Freemium ($5+/mo)" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} options`, competitor: "Curated set, more on Pro" },
      { name: "Device Frames", studio: "Safari, Chrome (light/dark), Arc, Polaroid", competitor: "macOS, browser" },
      { name: "3D Effects", studio: "Perspective tilt & rotation", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframes`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Not available" },
      { name: "Text Overlays", studio: `${atLeast(PRODUCT_FACTS.fonts)} fonts, full styling`, competitor: "Limited" },
      { name: "Code Snippets", studio: "Syntax highlighting, themes", competitor: "Not available" },
      { name: "Export Resolution", studio: "Up to 5x scale", competitor: "Up to 2x" },
      { name: "Signup Required", studio: "No", competitor: "For Pro features" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      "Shots.so is polished for basic screenshot beautification. Screenshot Studio matches that quality and adds animations, 3D effects, video export, and code snippet support at no cost.",
    faqs: [
      {
        q: "Is Screenshot Studio better than Shots.so?",
        a: `Screenshot Studio offers everything Shots.so does plus additional capabilities: 3D perspective effects, a full animation timeline with ${atLeast(PRODUCT_FACTS.animationPresets)} presets, video export (MP4/WebM/GIF), code snippet beautification, and text/image overlays. All free with no signup.`,
      },
      {
        q: "Does Shots.so have animation features?",
        a: "No. Shots.so is a static screenshot editor. Screenshot Studio includes a full animation timeline with keyframe editing and 20+ motion presets like zoom, pan, Ken Burns, and fade effects.",
      },
      {
        q: "Can I switch from Shots.so to Screenshot Studio?",
        a: "Yes, the switch is instant. Screenshot Studio requires no account or installation. Just open the editor, drag in your screenshot, and start editing with all features available immediately.",
      },
    ],
  },
  {
    slug: "snagit",
    scopeNote:
      "Snagit captures your screen and records it. Screenshot Studio does not: it starts from an image you already have. Take the shot with your operating system shortcut (Cmd+Shift+4 on macOS, Win+Shift+S on Windows) or with Snagit itself, then bring the file here for backgrounds, mockups, 3D, and animation. If screen capture and recording are what you need, Snagit is the right tool.",
    competitorName: "Snagit",
    competitorUrl: "https://www.techsmith.com/snagit",
    tagline:
      "A free, browser-based alternative to Snagit for screenshot beautification and sharing.",
    metaTitle: "Screenshot Studio vs Snagit: Free In-Browser",
    metaDescription:
      "Compare Screenshot Studio vs Snagit. Screenshot Studio is free and runs in your browser with gradient backgrounds, 3D effects, animations, and video export. No download required.",
    keywords: [
      "snagit alternative free",
      "snagit alternative",
      "screenshot studio vs snagit",
      "free snagit alternative",
      "snagit free alternative online",
      "browser based snagit alternative",
      "snagit competitor free",
    ],
    competitorPricing: "One-time purchase ~$63",
    competitorLimitations: [
      "Requires desktop installation",
      "Paid software (no free version)",
      "Windows/Mac only",
      "No animation timeline or motion presets",
      "No gradient backgrounds or mockup styling",
      "Heavy application (200MB+)",
    ],
    studioAdvantages: [
      "Free, runs in any browser",
      "No installation needed",
      `${atLeast(PRODUCT_FACTS.backgrounds)} styled backgrounds`,
      "3D perspective effects",
      `Animation with ${atLeast(PRODUCT_FACTS.animationPresets)} presets`,
      "Video export (MP4, WebM, GIF)",
      "Works on any OS including Chromebook",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "~$63 one-time" },
      { name: "Platform", studio: "Any browser (web app)", competitor: "Windows, Mac desktop" },
      { name: "Installation", studio: "None required", competitor: "Desktop app download" },
      { name: "Screen Capture", studio: "Via browser or OS tools", competitor: "Built-in capture" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, solids`, competitor: "Solid colors only" },
      { name: "Device Frames", studio: "Safari, Chrome (light/dark), Arc, Polaroid", competitor: "Not available" },
      { name: "3D Effects", studio: "Perspective transforms", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframes`, competitor: "Basic GIF recording" },
      { name: "Video Export", studio: "MP4, WebM, GIF from timeline", competitor: "Screen recording only" },
      { name: "Annotations", studio: "Text, arrows, overlays", competitor: "Text, arrows, shapes" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      "Snagit excels at screen capture and annotation for enterprise teams. Screenshot Studio is the better pick for beautifying screenshots with backgrounds, 3D effects, and animations, and it costs nothing.",
    faqs: [
      {
        q: "Can Screenshot Studio replace Snagit?",
        a: "For screenshot beautification, yes. Screenshot Studio offers gradient backgrounds, 3D effects, device frames, and animation that Snagit does not. Snagit has built-in screen capture and enterprise features like scrolling capture, which Screenshot Studio handles through browser/OS screenshot tools instead.",
      },
      {
        q: "Is Screenshot Studio really free compared to Snagit's price?",
        a: "Yes. Screenshot Studio is 100% free with no hidden costs, subscriptions, or feature locks. Snagit costs approximately $63 as a one-time purchase plus upgrade fees for major versions.",
      },
      {
        q: "Does Screenshot Studio work on Chromebooks?",
        a: "Yes. Screenshot Studio runs in any modern browser, including Chrome on Chromebooks, Linux, and mobile devices. Snagit only runs on Windows and macOS desktops.",
      },
    ],
  },
  {
    slug: "cleanshot-x",
    scopeNote:
      "CleanShot X is a macOS capture app: screen recording, scrolling capture, pinned overlays, and a capture hotkey. Screenshot Studio does none of that. It picks up after the capture, turning an existing image into a presentable graphic in any browser on any operating system. If you want the capture workflow itself, and you are on a Mac, CleanShot X is the right tool.",
    competitorName: "CleanShot X",
    competitorUrl: "https://cleanshot.com",
    tagline:
      "A free, cross-platform alternative to CleanShot X that runs in your browser.",
    metaTitle:
      "Screenshot Studio vs CleanShot X: Free Alternative",
    metaDescription:
      "Compare Screenshot Studio vs CleanShot X. Screenshot Studio is free, cross-platform, and adds gradient backgrounds, 3D effects, animations, and video export. No macOS required.",
    keywords: [
      "cleanshot x alternative",
      "cleanshot alternative free",
      "cleanshot x free alternative",
      "screenshot studio vs cleanshot",
      "cleanshot x vs screenshot studio",
      "cleanshot alternative windows",
      "cleanshot competitor",
    ],
    competitorPricing: "$29 one-time or $8/mo (Cloud)",
    competitorLimitations: [
      "macOS only",
      "Paid software",
      "No web-based editor",
      "No animation timeline",
      "Limited background styling",
      "No 3D perspective transforms",
    ],
    studioAdvantages: [
      "Free, works on any OS",
      "Runs in browser (no install)",
      `${atLeast(PRODUCT_FACTS.backgrounds)} gradient backgrounds`,
      "3D perspective effects",
      "Full animation timeline",
      "Video export (MP4, WebM, GIF)",
      "Open source",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "$29+ one-time" },
      { name: "Platform", studio: "Any browser", competitor: "macOS only" },
      { name: "Screen Capture", studio: "Via browser/OS tools", competitor: "Built-in (excellent)" },
      { name: "Background Styling", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, images`, competitor: "Basic solid backgrounds" },
      { name: "Device Frames", studio: "Safari, Chrome (light/dark), Arc, Polaroid", competitor: "Not available" },
      { name: "3D Effects", studio: "Full perspective transforms", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframes`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Screen recording" },
      { name: "Cloud Storage", studio: "Local (privacy-first)", competitor: "CleanShot Cloud" },
      { name: "Annotations", studio: "Text, arrows, overlays", competitor: "Text, arrows, shapes, blur" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      "CleanShot X is the best macOS screen capture tool. Screenshot Studio is the better choice for screenshot beautification with backgrounds, 3D effects, and animations, and works on any platform for free.",
    faqs: [
      {
        q: "Is Screenshot Studio a good CleanShot X alternative?",
        a: "For screenshot beautification, yes. Screenshot Studio offers gradient backgrounds, 3D perspective, animations, and video export that CleanShot X lacks. CleanShot X has superior built-in screen capture, scrolling capture, and macOS integration.",
      },
      {
        q: "Can I use Screenshot Studio on Windows or Linux?",
        a: "Yes. Screenshot Studio runs in any modern browser on Windows, macOS, Linux, and Chromebooks. CleanShot X is macOS-only.",
      },
      {
        q: "Does CleanShot X have animation features?",
        a: `No. CleanShot X focuses on screen capture and basic annotation. Screenshot Studio provides a full animation timeline with ${atLeast(PRODUCT_FACTS.animationPresets)} presets and exports animations as MP4, WebM, or GIF.`,
      },
    ],
  },
  {
    slug: "screely",
    competitorName: "Screely",
    competitorUrl: "https://screely.com",
    tagline:
      "More backgrounds, effects, and export options than Screely, all free.",
    metaTitle: "Screenshot Studio vs Screely: More Features, Free",
    metaDescription:
      `Compare Screenshot Studio vs Screely. Both are free screenshot editors, but Screenshot Studio adds 3D effects, animations, video export, device frames, and ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds.`,
    keywords: [
      "screely alternative",
      "screely vs screenshot studio",
      "screenshot studio vs screely",
      "better than screely",
      "screely alternative with more features",
      "screely competitor",
    ],
    competitorPricing: "Free",
    competitorLimitations: [
      "Limited background options",
      "No device frames",
      "No 3D effects",
      "No animations or video",
      "No text overlays",
      "Basic shadow options only",
    ],
    studioAdvantages: [
      `${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds (gradients, images, mesh)`,
      "Device frames (macOS, Windows, Arc, Polaroid)",
      "3D perspective transforms",
      `Animation timeline with ${atLeast(PRODUCT_FACTS.animationPresets)} presets`,
      "Video export (MP4, WebM, GIF)",
      "Text and image overlay layers",
      "High-res export up to 5x",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "Free" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, solids, images`, competitor: "Solid colors" },
      { name: "Device Frames", studio: "Safari, Chrome (light/dark), Arc, Polaroid", competitor: "Browser frame only" },
      { name: "Shadows", studio: "Blur, spread, offset, color", competitor: "Basic drop shadow" },
      { name: "3D Effects", studio: "Perspective tilt & rotation", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframes`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Not available" },
      { name: "Text Overlays", studio: `${atLeast(PRODUCT_FACTS.fonts)} fonts, shadows`, competitor: "Not available" },
      { name: "Export Resolution", studio: "Up to 5x scale", competitor: "Standard" },
      { name: "Undo/Redo", studio: "Unlimited history", competitor: "Not available" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      `Screely is a simple tool for adding a window frame to screenshots. Screenshot Studio does everything Screely does and much more: ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, 3D effects, animations, video export, and device frames.`,
    faqs: [
      {
        q: "How does Screenshot Studio compare to Screely?",
        a: `Screenshot Studio covers all of Screely's features and adds significantly more: ${atLeast(PRODUCT_FACTS.backgrounds)} gradient backgrounds, multiple device frames (macOS, Windows, Arc), 3D perspective transforms, animation timeline, video export, text overlays, and high-res export up to 5x.`,
      },
      {
        q: "Is Screely or Screenshot Studio better for developers?",
        a: "Screenshot Studio is the better choice for developers. It offers code snippet beautification, terminal window frames, 3D perspective mockups for portfolio images, and animation export for demo videos, none of which Screely provides.",
      },
    ],
  },
  {
    slug: "carbon",
    competitorName: "Carbon",
    competitorUrl: "https://carbon.now.sh",
    tagline:
      "Screenshot Studio turns code into images with more themes, backgrounds, and export formats, and it also handles screenshots and mockups.",
    metaTitle: "Screenshot Studio vs Carbon: Free Code to Image",
    metaDescription:
      `Compare Screenshot Studio vs Carbon for code screenshots. Screenshot Studio adds ${PRODUCT_FACTS.codeThemes} themes, ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, browser mockups, 3D effects, and video export. Free, no signup.`,
    keywords: [
      "carbon alternative",
      "carbon.now.sh alternative",
      "carbon code screenshot alternative",
      "code to image tool",
      "code snippet screenshot generator",
      "screenshot studio vs carbon",
      "beautiful code screenshots",
    ],
    competitorPricing: "Free",
    competitorLimitations: [
      "Code only, no screenshot or mockup editing",
      "Small set of backgrounds",
      "No 3D perspective or animations",
      "PNG and SVG export only",
      "No browser or device frames",
    ],
    studioAdvantages: [
      `${PRODUCT_FACTS.codeThemes} syntax themes with ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds`,
      "Code images plus screenshot and mockup editing in one tool",
      "3D perspective transforms and animation presets",
      "Export PNG, JPEG, WebP, MP4, WebM, and GIF",
      "Browser and device frames around code",
      "No signup, no watermarks",
      "Open source",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "Free" },
      { name: "Syntax Themes", studio: "32", competitor: "About 30" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, solids, images`, competitor: "Solid colors" },
      { name: "Screenshot Editing", studio: "Full editor", competitor: "Not available" },
      { name: "Device Frames", studio: "Safari, Chrome, Arc, macOS window", competitor: "macOS window only" },
      { name: "3D Effects", studio: "Full perspective transforms", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframe editor`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Not available" },
      { name: "Image Export", studio: "PNG, JPEG, WebP up to 5x", competitor: "PNG, SVG" },
      { name: "Signup Required", studio: "No", competitor: "No" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "Yes" },
    ],
    verdict:
      "Carbon is a solid single-purpose code image tool. Screenshot Studio does the same job with more themes and backgrounds, then lets you frame, animate, and export the result as an image or video.",
    faqs: [
      {
        q: "Is Screenshot Studio a good Carbon alternative?",
        a: `Yes. Screenshot Studio generates code images with ${PRODUCT_FACTS.codeThemes} syntax themes, line numbers, window chrome, and ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, then adds features Carbon lacks: browser mockups, 3D transforms, animations, and video export. It is free with no signup.`,
      },
      {
        q: "Can I export code images as video?",
        a: "Yes. Screenshot Studio exports code images as MP4, WebM, or GIF using its animation timeline, which is useful for demo videos and social posts. Carbon exports static PNG and SVG only.",
      },
    ],
  },
  {
    slug: "ray-so",
    competitorName: "Ray.so",
    competitorUrl: "https://ray.so",
    tagline:
      "Screenshot Studio offers more themes, backgrounds, frames, and export formats than Ray.so, plus full screenshot and mockup editing.",
    metaTitle: "Screenshot Studio vs Ray.so: Free Code Images",
    metaDescription:
      `Compare Screenshot Studio vs Ray.so for code screenshots. Screenshot Studio adds ${PRODUCT_FACTS.codeThemes} themes, ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, browser mockups, 3D effects, animations, and video export. Free, no signup.`,
    keywords: [
      "ray.so alternative",
      "ray so alternative",
      "ray.so vs screenshot studio",
      "code screenshot tool",
      "code to image generator",
      "raycast code image alternative",
      "code snippet to image",
    ],
    competitorPricing: "Free",
    competitorLimitations: [
      "Code only, no screenshot editing",
      "Fixed set of gradient themes",
      "No browser or device frames",
      "No 3D effects or animations",
      "Static image export only",
    ],
    studioAdvantages: [
      `${PRODUCT_FACTS.codeThemes} syntax themes, ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds`,
      "Screenshot and mockup editor in the same tool",
      "Browser, device, and macOS window frames",
      "3D perspective transforms and animations",
      "Video export (MP4, WebM, GIF)",
      "No signup, no watermarks",
      "Open source",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "Free" },
      { name: "Syntax Themes", studio: "32", competitor: "About 20" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, solids, images`, competitor: "Theme gradients" },
      { name: "Screenshot Editing", studio: "Full editor", competitor: "Not available" },
      { name: "Device Frames", studio: "Safari, Chrome, Arc, macOS window", competitor: "Not available" },
      { name: "3D Effects", studio: "Full perspective transforms", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframe editor`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Not available" },
      { name: "Image Export", studio: "PNG, JPEG, WebP up to 5x", competitor: "PNG, SVG" },
      { name: "Signup Required", studio: "No", competitor: "No" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "Yes" },
    ],
    verdict:
      "Ray.so is fast and pretty for a quick code snippet. Screenshot Studio covers the same use case and goes further with frames, 3D effects, animations, and video export, all free.",
    faqs: [
      {
        q: "Is Screenshot Studio a good Ray.so alternative?",
        a: `Yes. Screenshot Studio produces the same clean code images with ${PRODUCT_FACTS.codeThemes} themes and ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, and adds browser mockups, 3D perspective, animations, and video export. It is free, open source, and needs no signup.`,
      },
      {
        q: "Does Ray.so support browser mockups or animations?",
        a: "No. Ray.so exports static code images only. Screenshot Studio lets you wrap code in Safari, Chrome, or macOS frames, tilt it in 3D, animate it, and export as MP4, WebM, or GIF.",
      },
    ],
  },
  {
    slug: "xnapper",
    scopeNote:
      "Xnapper captures the screen and cleans the result up, including automatic text redaction. Screenshot Studio starts from an image you already have and has no capture step and no redaction. Use your operating system capture shortcut first, then bring the file here for backgrounds, mockups, 3D, and animation.",
    competitorName: "Xnapper",
    competitorUrl: "https://xnapper.com",
    tagline:
      "Screenshot Studio gives you Xnapper-style beautified screenshots in the browser, on any OS, with 3D effects, animations, and video export at no cost.",
    metaTitle: "Screenshot Studio vs Xnapper: Free Online",
    metaDescription:
      `Compare Screenshot Studio vs Xnapper. Xnapper is a paid macOS app; Screenshot Studio runs free in any browser with ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, browser mockups, 3D effects, animations, and video export.`,
    keywords: [
      "xnapper alternative",
      "xnapper free alternative",
      "xnapper for windows",
      "xnapper vs screenshot studio",
      "screenshot beautifier app alternative",
      "xnapper online alternative",
      "beautiful screenshots mac windows",
    ],
    competitorPricing: "One-time purchase from $29.99, macOS only",
    competitorLimitations: [
      "macOS only, requires install",
      "Paid license required",
      "No 3D perspective effects",
      "No animations or video export",
      "Limited device frame options",
    ],
    studioAdvantages: [
      "Runs in any browser on macOS, Windows, and Linux",
      "Free forever, no license",
      `${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds and browser mockups`,
      "3D perspective transforms",
      "Animation timeline and video export",
      "No signup, no watermarks",
      "Open source",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "$29.99+ one-time" },
      { name: "Platform", studio: "Any browser", competitor: "macOS app" },
      { name: "Backgrounds", studio: `${atLeast(PRODUCT_FACTS.backgrounds)} gradients, solids, images`, competitor: "Gradients and wallpapers" },
      { name: "Device Frames", studio: "Safari, Chrome, Arc, Polaroid, macOS window", competitor: "macOS window" },
      { name: "Screen Capture", studio: "Upload or paste", competitor: "Built-in capture" },
      { name: "3D Effects", studio: "Full perspective transforms", competitor: "Not available" },
      { name: "Animations", studio: `${atLeast(PRODUCT_FACTS.animationPresets)} presets, keyframe editor`, competitor: "Not available" },
      { name: "Video Export", studio: "MP4, WebM, GIF", competitor: "Not available" },
      { name: "Export Resolution", studio: "Up to 5x scale", competitor: "Retina" },
      { name: "Signup Required", studio: "No", competitor: "License key" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      "Xnapper is a good native macOS capture tool if you want to pay for it. Screenshot Studio delivers the same beautified result for free in the browser, on any OS, and adds 3D, animation, and video export.",
    faqs: [
      {
        q: "Is there a free alternative to Xnapper?",
        a: "Yes. Screenshot Studio is a free, open-source alternative to Xnapper that runs in your browser. It adds backgrounds, shadows, browser mockups, 3D effects, and animations to any screenshot with no signup and no watermark.",
      },
      {
        q: "Does Xnapper work on Windows?",
        a: "No. Xnapper is macOS only. Screenshot Studio works in any modern browser on Windows, macOS, Linux, and ChromeOS, so you get the same beautified screenshots without installing anything.",
      },
    ],
  },
  {
    slug: "remove-bg",
    competitorName: "remove.bg",
    competitorUrl: "https://www.remove.bg",
    tagline:
      "Screenshot Studio removes backgrounds on your own device and gives you the full-resolution PNG for free, with no upload and no credits.",
    metaTitle: "Screenshot Studio vs remove.bg: Free, No Upload",
    metaDescription:
      "Screenshot Studio vs remove.bg: remove backgrounds on your device and download full-resolution transparent PNGs free. No upload, no credits, no signup.",
    keywords: [
      "remove.bg alternative",
      "remove bg alternative free",
      "remove.bg free alternative",
      "screenshot studio vs remove.bg",
      "remove.bg alternative no upload",
      "remove.bg full resolution free",
      "remove.bg moving to canva alternative",
      "private background remover",
    ],
    competitorPricing: "Free previews up to 0.25 MP; 1 credit per high-resolution image",
    competitorLimitations: [
      "Free downloads are previews of up to 0.25 megapixels",
      "Each high-resolution download uses a paid credit",
      "Images are processed on remote servers",
      "Standalone site is being migrated into Canva",
    ],
    studioAdvantages: [
      "Full-resolution transparent PNG for free",
      "Runs on your device, the image is never uploaded",
      "Works offline once the model is cached",
      "No credits, signup, or watermark",
      "Crisp and soft edge styles with a comparison slider",
      "Open source",
    ],
    features: [
      { name: "Price", studio: "Free forever", competitor: "Free previews, credits for HD" },
      { name: "Free Output Resolution", studio: "Original resolution", competitor: "Up to 0.25 MP preview" },
      { name: "Maximum Resolution", studio: "Original image, up to 50 MB file", competitor: "Up to 50 MP with credits" },
      { name: "Where Processing Happens", studio: "On your device", competitor: "remove.bg servers" },
      { name: "Image Upload", studio: "Never", competitor: "Required" },
      { name: "Works Offline", studio: "Yes, after first load", competitor: "Not available" },
      { name: "API and Apps", studio: "Not available", competitor: "Yes, credit based" },
      { name: "Screenshot and Mockup Editor", studio: "Included", competitor: "Not available" },
      { name: "Open Source", studio: "Yes (Apache 2.0)", competitor: "No" },
    ],
    verdict:
      "remove.bg is a mature service with apps, an API, and server-side models that handle difficult hair detail well, but free downloads are low-resolution previews. Screenshot Studio is the better fit when you want full-resolution cutouts for free, or when a photo should never leave your device.",
    faqs: [
      {
        q: "Is Screenshot Studio a good remove.bg alternative?",
        a: "Yes, for everyday cutouts. Screenshot Studio removes backgrounds with an AI model that runs in your browser and returns a transparent PNG at the original resolution for free. remove.bg's free downloads are previews of up to 0.25 megapixels, and high-resolution downloads use credits.",
      },
      {
        q: "Does Screenshot Studio upload my image?",
        a: "No. The image is processed on your device. The only network request is a one-time download of the model weights from Hugging Face, which contains no image data. remove.bg processes images on its own servers.",
      },
      {
        q: "When should I still use remove.bg?",
        a: "When you need an API or its apps, or the best possible detail on hard cases like fine hair against a busy background. Its server-side models are not limited by what a browser can run.",
      },
    ],
    cta: { href: "/remove-background", label: "Remove a Background Free" },
  },
];

export function getComparison(slug: string): ComparisonData | undefined {
  return comparisons.find((c) => c.slug === slug);
}

export function getAllComparisonSlugs(): string[] {
  return comparisons.map((c) => c.slug);
}

/** Sourcing line shown under every competitor claim, so no price is asserted unattributed. */
export function claimsNote(comparison: ComparisonData): string {
  return `${comparison.competitorName} pricing and feature details checked on ${CLAIMS_CHECKED_LABEL} against ${comparison.competitorUrl}. Third-party plans change without notice, so confirm current pricing on their site before deciding.`;
}

/** SERP title: the brand already opens the `vs` construction, so no suffix, and the year is never hardcoded. */
export function getComparisonTitle(comparison: ComparisonData): string {
  return `${comparison.metaTitle} (${new Date().getFullYear()})`;
}
