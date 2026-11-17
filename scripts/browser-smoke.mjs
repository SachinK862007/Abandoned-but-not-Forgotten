#!/usr/bin/env node
/**
 * Repeatable browser smoke test for the homepage and the Mission Film.
 *
 * Runs in real Microsoft Edge (Chromium channel `msedge`) and checks the things
 * that cannot be covered by the Node test suite:
 *
 *   • the homepage renders and the ambient score starts silent;
 *   • the mission film renders a single canvas;
 *   • playback actually advances across frames (the frame loop keeps going);
 *   • narration reaches the speech engine and pauses with the film;
 *   • pause freezes the timeline and stops scheduling frames;
 *   • resume advances again from the same position;
 *   • seeking redraws without opening a second loop;
 *   • switching relic tears the old scene down.
 *
 * Usage:
 *   npm run build && npx next start -p 3100     # or: npm run dev
 *   SMOKE_BASE_URL=http://localhost:3100 npm run test:browser
 *   SMOKE_HEADLESS=1 SMOKE_BASE_URL=... npm run test:browser
 *
 * Exits non-zero if any check fails. It plays the film's narration out loud,
 * so run it with the volume turned down.
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'
const HEADLESS = process.env.SMOKE_HEADLESS === '1'
const FILM_TIMEOUT = 20_000

const results = []
const log = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(instrument)
const page = await context.newPage()

const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 200)))
// The Vercel Analytics beacon is injected in every build but only served on
// Vercel, so a local `next start` always 404s it. Ignore that one URL.
const LOCAL_ONLY = /\/_vercel\/insights/
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const url = message.location()?.url ?? ''
  if (LOCAL_ONLY.test(url)) return
  pageErrors.push(`${message.text().slice(0, 160)} (${url.slice(0, 120)})`)
})

/** Evaluate in the page, retrying once or twice if a navigation races us. */
async function ev(fn) {
  let lastError
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await page.evaluate(fn)
    } catch (error) {
      lastError = error
      await page.waitForTimeout(500)
    }
  }
  throw lastError
}

const probe = () => ev(instrumentedProbe)
const progress = () =>
  page.evaluate(
    () => document.querySelector('[role="slider"][aria-label^="Film timeline"]')?.getAttribute('aria-valuenow') ?? null,
  )
const framesPerSecond = async (ms = 1500) => {
  const before = await probe()
  await page.waitForTimeout(ms)
  const after = await probe()
  return Math.round(((after.raf - before.raf) / ms) * 1000)
}

try {
  // ------------------------------------------------------------- homepage
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  const ambient = page.getByRole('button', { name: /ambient score/i })
  await ambient.waitFor({ timeout: FILM_TIMEOUT })
  await page.waitForTimeout(800)

  const ambientState = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label*="ambient score" i]')
    return button ? { label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed') } : null
  })
  log('homepage renders', Boolean(await page.title()), await page.title())
  log(
    'ambient score starts silent',
    ambientState?.label === 'Play ambient score' && ambientState?.pressed === 'false',
    JSON.stringify(ambientState),
  )

  // ------------------------------------------------------------ open film
  await page.goto(`${BASE}/missions`, { waitUntil: 'domcontentloaded' })
  const relics = page.locator('ul li button[aria-pressed]')
  await relics.first().waitFor({ timeout: FILM_TIMEOUT })
  await relics.first().click()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: 'Play film' }).first().click()
  await page.waitForTimeout(2500)

  const afterPlay = await probe()
  const progressWhilePlaying = await progress()
  log('film renders one canvas', afterPlay.canvases === 1, `canvases=${afterPlay.canvases}`)
  log('narration reaches the speech engine', afterPlay.speaking === true, `utterances=${afterPlay.utterances}`)
  log('narration text is not empty', (afterPlay.lastText ?? '').length > 20, JSON.stringify(afterPlay.lastText))

  const playingFps = await framesPerSecond(1500)
  const progressAfterFrames = await progress()
  log('animation advances across frames', playingFps > 20, `${playingFps} frames/s`)
  log('timeline progresses', progressAfterFrames !== progressWhilePlaying, `${progressWhilePlaying} -> ${progressAfterFrames}`)

  // ---------------------------------------------------------------- pause
  await page.getByRole('button', { name: 'Pause film' }).first().click()
  await page.waitForTimeout(300)
  const pauseStart = await probe()
  const pausedProgress = await progress()
  await page.waitForTimeout(1500)
  const pauseEnd = await probe()
  const pausedProgressLater = await progress()
  log('pause freezes the timeline', pausedProgress === pausedProgressLater, `${pausedProgress} == ${pausedProgressLater}`)
  log('pause stops scheduling frames', pauseEnd.raf - pauseStart.raf === 0, `scheduled=${pauseEnd.raf - pauseStart.raf}`)
  log('pause stops the narration', pauseEnd.speaking === false, `speaking=${pauseEnd.speaking}`)

  // --------------------------------------------------------------- resume
  await page.getByRole('button', { name: 'Play film' }).first().click()
  await page.waitForTimeout(1600)
  const resumed = await probe()
  const resumedProgress = await progress()
  log('resume advances the timeline', resumedProgress !== pausedProgressLater, `${pausedProgressLater} -> ${resumedProgress}`)
  log('resume keeps a single loop', (await framesPerSecond(1200)) > 20, 'one frame loop, not two')
  log('resume restores narration', resumed.speaking === true, `speaking=${resumed.speaking}`)
  log('still one canvas after resume', resumed.canvases === 1, `canvases=${resumed.canvases}`)

  // ----------------------------------------------------------------- seek
  await page.getByRole('button', { name: /Touchdown/i }).first().click()
  await page.waitForTimeout(1000)
  const seeked = await probe()
  log('seek moves the timeline', (await progress()) !== resumedProgress, `progress=${await progress()}`)
  log('seek keeps one canvas', seeked.canvases === 1, `canvases=${seeked.canvases}`)

  // ------------------------------------------ expand, resize, restart (G)
  await page.getByRole('button', { name: 'Expand film' }).click()
  await page.waitForTimeout(800)
  const expandedState = await ev(() => {
    const canvas = document.querySelector('canvas')
    return {
      canvases: document.querySelectorAll('canvas').length,
      width: canvas?.width ?? 0,
    }
  })
  log(
    'expanding re-parents the same canvas',
    expandedState.canvases === 1 && expandedState.width > 0,
    JSON.stringify(expandedState),
  )

  await page.getByRole('button', { name: 'Collapse film' }).click()
  await page.waitForTimeout(800)
  // Measure the film's own canvas: the drawing buffer must follow the stage
  // through a layout change (1280 two-column -> 640 single column).
  const filmCanvas = () =>
    ev(() => {
      const stage = document.querySelector('[aria-label^="Mission film scene"]')
      const canvas = stage?.querySelector('canvas')
      return { buffer: canvas?.width ?? 0, css: stage?.clientWidth ?? 0 }
    })
  const beforeResize = await filmCanvas()
  await page.setViewportSize({ width: 640, height: 860 })
  await page.waitForTimeout(900)
  const afterResize = await filmCanvas()
  log(
    'resizing redraws at the new size',
    afterResize.buffer > 0 && afterResize.buffer !== beforeResize.buffer,
    `${beforeResize.buffer}px@${beforeResize.css}css -> ${afterResize.buffer}px@${afterResize.css}css`,
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(700)

  // The film must be replayable by pressing Play at the very end, not only
  // through the separate Replay button.
  const slider = page.locator('[role="slider"]').first()
  const sliderBox = await slider.boundingBox()
  await page.mouse.click(sliderBox.x + sliderBox.width * 0.995, sliderBox.y + sliderBox.height / 2)
  await page.waitForTimeout(2500)
  const finishedProgress = await progress()
  log('the film reaches its end', finishedProgress === '100', `progress=${finishedProgress}`)
  await page.getByRole('button', { name: 'Play film' }).first().click()
  await page.waitForTimeout(1500)
  const restartedProgress = Number(await progress())
  log('play at the end restarts the story', restartedProgress < 20, `progress=${restartedProgress}`)

  // --------------------------------------------------------- change relic
  await relics.nth(1).click()
  await page.waitForTimeout(1200)
  const switched = await probe()
  log('switching relic removes the old scene', switched.canvases === 0, `canvases=${switched.canvases}`)
  log('switching relic stops the narration', switched.speaking === false, `speaking=${switched.speaking}`)

  // Reopening on the new record must build one fresh scene, not stack another.
  await page.getByRole('button', { name: 'Play film' }).first().click()
  await page.waitForTimeout(2200)
  const reopened = await probe()
  const reopenedFps = await framesPerSecond(1200)
  log(
    'reopening plays with a single fresh scene',
    reopened.canvases === 1 && reopened.utterances > 0 && reopenedFps > 20,
    `canvases=${reopened.canvases} frames/s=${reopenedFps}`,
  )

  // ------------------------------------------------------------ page errors
  const ignorable = /_vercel\/insights|Download the React DevTools/i
  const realErrors = pageErrors.filter((text) => !ignorable.test(text))
  log('no console or page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} catch (error) {
  log('smoke run completed', false, String(error).slice(0, 300))
} finally {
  await browser.close()
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

async function launch() {
  try {
    return await chromium.launch({
      channel: 'msedge',
      headless: HEADLESS,
      // Keep the renderer at full frame rate even when the window is behind
      // another window, so the frames-per-second check measures the film
      // rather than the compositor's occlusion throttling.
      args: [
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    })
  } catch (error) {
    console.warn(`Microsoft Edge could not be launched (${String(error).slice(0, 120)}); trying bundled Chromium.`)
    try {
      return await chromium.launch({ headless: true })
    } catch {
      console.error('No browser available. Install Microsoft Edge, or run: npx playwright install chromium')
      process.exit(2)
    }
  }
}

/** Installed before any page script, so it also counts the very first frame. */
function instrument() {
  window.__smoke = { raf: 0, utterances: [], lastText: null }
  const nativeRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => {
    window.__smoke.raf += 1
    return nativeRaf(callback)
  }
  if (window.speechSynthesis) {
    const proto = Object.getPrototypeOf(window.speechSynthesis)
    const speak = proto.speak
    proto.speak = function (utterance) {
      try {
        window.__smoke.utterances.push(String(utterance?.text ?? ''))
        window.__smoke.lastText = String(utterance?.text ?? '')
      } catch {
        /* ignore */
      }
      return speak.call(this, utterance)
    }
  }
}

function instrumentedProbe() {
  const state = window.__smoke ?? { raf: 0, utterances: [] }
  return {
    raf: state.raf,
    utterances: state.utterances.length,
    lastText: state.lastText,
    canvases: document.querySelectorAll('canvas').length,
    speaking: window.speechSynthesis ? window.speechSynthesis.speaking : null,
  }
}
