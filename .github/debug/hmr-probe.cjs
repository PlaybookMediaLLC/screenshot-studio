// Temporary CI probe: why does /sign-up reload in a loop under next dev on Linux?
const { chromium } = require(process.cwd() + '/node_modules/playwright')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  let loads = 0
  const frames = []
  page.on('load', () => loads++)
  page.on('websocket', (ws) => {
    frames.push(`OPEN ${ws.url()}`)
    ws.on('framereceived', (f) => frames.length < 60 && frames.push(`<- ${String(f.payload).slice(0, 400)}`))
    ws.on('framesent', (f) => frames.length < 60 && frames.push(`-> ${String(f.payload).slice(0, 200)}`))
    ws.on('close', () => frames.push('CLOSE'))
  })
  await page.goto('http://localhost:3000/sign-up')
  await page.waitForTimeout(15000)
  console.log('loads:', loads)
  for (const f of frames) console.log(f)
  await browser.close()
})()
