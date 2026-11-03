// Original Sofra brand artwork. See docs/ASSET_PROVENANCE.md.
// Uses local text/vector rendering only; no photos or network requests.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { createElement } from 'react'

const require = createRequire(import.meta.url)
const { ImageResponse } = require('next/og')
const destination = new URL('../public/sofra-social.png', import.meta.url)

const palette = {
  paper: '#faf6ed',
  ink: '#362b25',
  clay: '#b36548',
  sage: '#a8b18c',
  linen: '#e9e0cf',
}

function box(style, ...children) {
  return createElement(
    'div',
    { style: { display: 'flex', ...style } },
    ...children,
  )
}

function circle(left, top, size, background, border) {
  return box({
    position: 'absolute',
    left,
    top,
    width: size,
    height: size,
    borderRadius: '50%',
    background,
    ...(border ? { border } : {}),
  })
}

const table = box(
  {
    position: 'absolute',
    right: 46,
    top: 90,
    width: 470,
    height: 440,
  },
  circle(42, 24, 370, palette.linen),
  circle(62, 44, 330, palette.paper, `2px solid ${palette.sage}`),
  ...[
    [190, 3],
    [338, 89],
    [338, 259],
    [190, 344],
    [42, 259],
    [42, 89],
  ].map(([x, y]) => circle(x, y, 74, palette.sage)),
  ...[
    [198, 66],
    [291, 118],
    [291, 227],
    [198, 278],
    [105, 227],
    [105, 118],
  ].map(([x, y]) =>
    circle(x, y, 57, palette.paper, `3px solid ${palette.clay}`),
  ),
  circle(195, 177, 64, palette.clay),
  circle(208, 190, 38, palette.paper),
  circle(259, 190, 14, palette.clay),
)

const artwork = box(
  {
    width: '100%',
    height: '100%',
    position: 'relative',
    background: palette.paper,
    color: palette.ink,
    padding: 64,
    flexDirection: 'column',
    fontFamily: 'Geist',
  },
  box({ fontSize: 116, letterSpacing: '-7px' }, 'Sofra'),
  circle(332, 164, 15, palette.clay),
  box(
    { width: 550, marginTop: 56, fontSize: 48, lineHeight: 1.16 },
    'Join a Turkish household table.',
  ),
  box(
    { marginTop: 28, color: palette.clay, fontSize: 19, letterSpacing: '2px' },
    'DINNER / TEA / CONVERSATION',
  ),
  table,
  box(
    {
      position: 'absolute',
      left: 64,
      right: 64,
      bottom: 44,
      paddingTop: 22,
      borderTop: `1px solid ${palette.linen}`,
      justifyContent: 'space-between',
      fontSize: 18,
    },
    box({}, 'A MaydaLabs project'),
    box({}, 'Portfolio prototype'),
  ),
)

const response = new ImageResponse(artwork, { width: 1200, height: 630 })
const png = Buffer.from(await response.arrayBuffer())

if (process.argv.includes('--check')) {
  if (!png.equals(await readFile(destination))) {
    throw new Error('Social image differs from its source. Regenerate it.')
  }
  console.log('Social image matches its source (1200 × 630).')
} else {
  await writeFile(destination, png)
  console.log('Generated public/sofra-social.png (1200 × 630).')
}
