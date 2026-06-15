// Rasterize resources/icon.svg → resources/icon.png (1024×1024) using a hidden
// Electron BrowserWindow. We already depend on Electron, so this avoids
// pulling in rsvg-convert / inkscape / sharp just for a one-off icon build.
//
// Run:  pnpm exec electron scripts/render-icon.cjs
//
// After PNG exists, build the macOS .icns via:
//   bash scripts/build-icns.sh

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 1024
const SRC = path.join(__dirname, '..', 'resources', 'icon.svg')
const OUT = path.join(__dirname, '..', 'resources', 'icon.png')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SRC, 'utf8')
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${SIZE}px;height:${SIZE}px}
  </style></head><body>${svg}</body></html>`

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  })

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // Give the WebContents a tick to paint the SVG.
  await new Promise(r => setTimeout(r, 200))

  const img = await win.webContents.capturePage()
  fs.writeFileSync(OUT, img.toPNG())
  console.log(`wrote ${OUT} (${img.getSize().width}×${img.getSize().height})`)

  app.quit()
})
