# Create a Shots draft from a URL

The browser entry point `https://<your Shots host>/?new=<URL-encoded text>` opens a review of the decoded text. A signed-out author signs in first; **Create draft** is still an explicit action. `---` on its own line or four blank lines separates posts. No API key goes into the URL.

## Apple Shortcuts source

`Create Shots Draft.shortcut` is an **unsigned** native property-list source: Ask for Text → URL Encode → Text containing the Shots import URL → Open URLs. It asks for text rather than silently reading the clipboard. It does not create or publish without the browser review.

For another deployment, run:

```sh
python3 build.py --origin https://your-shots-host.example
```

On a Mac with Shortcuts, inspect/import the source and sign it for distribution:

```sh
shortcuts sign --mode anyone --input 'Create Shots Draft.shortcut' --output 'Create Shots Draft.signed.shortcut'
```

Apple may require import/re-export from the Shortcuts editor before signing, depending on OS version. If unsigned import is unavailable, reproduce the four named actions in the Shortcuts editor, putting the URL Encoded Text variable after `/?new=` in the Text action, then share the Shortcut through Apple's normal flow.

Linux checks validate the plist structure and linked action output, not Apple import/signing or an iOS run. Those native checks remain outstanding; the file is not represented as a signed, one-click install.

## Raycast Quick Link

In Raycast's **Create Quicklink** command, use the name and URL from `raycast-quicklink.json`, replacing the origin with your deployment. The `{Draft text}` argument is entered when invoked. Verify special characters (`&`, `+`, `%`, emoji and newlines) on your Raycast version before sharing. If that version does not encode arguments, use the full [Raycast extension](../raycast/README.md), whose transport serializes the text explicitly.

The import browser regression covers percent signs, plus signs, Unicode, sign-in handoff, thread splitting and explicit creation. Native Raycast Quicklink execution and Apple signing require their respective OS/application environments and are not locally verified.
