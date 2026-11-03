# Asset provenance

## Social preview

`public/sofra-social.png` is original Sofra brand artwork created for this project
on November 3, 2026. Its editable source is
`scripts/generate-social-image.mjs`, covered by the repository's MIT license.
It uses typography and geometric table/place-setting shapes in Sofra's palette.
It contains no photograph, real person, household, customer data, or external
image. The artwork identifies the project as a portfolio prototype.

Generate or verify the committed PNG with the installed project dependencies:

```bash
node scripts/generate-social-image.mjs
node scripts/generate-social-image.mjs --check
```

The generator uses Next.js `ImageResponse` locally, including its bundled Geist
Regular font. It makes no network requests. Geist is Copyright 2024 The Geist
Project Authors and licensed under the SIL Open Font License 1.1; see the
[Geist font project](https://github.com/vercel/geist-font) and its license.
No font binary is copied into this repository. Dependency upgrades can change
rendering; inspect and regenerate the image deliberately when that occurs.

## Product screenshots and illustrations

The four images in `docs/screens/` depict the application's fictional demo mode.
They are earlier walkthrough captures, not screenshots from the November 3 test
run. The in-app editorial illustrations are built from CSS in
`src/components/editorial-photo.tsx`.

## Other third-party assets

- The application loads DM Sans and Newsreader through `next/font/google`.
  Preserve the relevant font licenses when redistributing font binaries or
  packaged build output.
- The unused starter SVGs under `public/` came from the Next.js scaffold.
  Next.js and Vercel logos remain their respective owners' marks; Sofra's MIT
  license does not grant trademark rights.
- Lucide icons carry the package's ISC license and notices for Feather-derived
  icons. Keep dependency license notices with redistributed packages.

This inventory describes asset origins; it is not a comprehensive transitive
dependency-license audit.
