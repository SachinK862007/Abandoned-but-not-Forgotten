// AmbientScore: the score must start silent, and only a deliberate gesture may
// start it. These are static invariants over the component plus the shared
// constants it uses — a real audible check needs a browser.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DEFAULT_ENABLED, DEFAULT_VOLUME, clampVolume, targetGain } from '../lib/ambient-score-core.mjs'

const source = fs.readFileSync('components/space/ambient-score.tsx', 'utf8')

test('the score starts silent', () => {
  assert.equal(DEFAULT_ENABLED, false)
  assert.equal(DEFAULT_VOLUME, 100, 'volume still defaults to 100%')
})

test('the component starts from the silent defaults', () => {
  assert.ok(source.includes('useRef(DEFAULT_ENABLED)'), 'ref starts disabled')
  assert.ok(source.includes('useState(DEFAULT_ENABLED)'), 'state starts disabled')
  assert.ok(
    source.includes("aria-label={enabled ? 'Mute ambient score' : 'Play ambient score'}"),
    'the first label is "Play ambient score"',
  )
  assert.ok(source.includes('aria-pressed={enabled}'))
})

test('gain is zero while muted, whatever the slider says', () => {
  assert.equal(targetGain(100, false), 0)
  assert.equal(targetGain(50, false), 0)
  assert.equal(targetGain(100, true), 1)
  assert.equal(targetGain(40, true), 0.4)
})

test('volume stays inside 0-100', () => {
  assert.equal(clampVolume(-10), 0)
  assert.equal(clampVolume(150), 100)
  assert.equal(clampVolume(Number.NaN), DEFAULT_VOLUME)
})

test('no passive event can start the audio', () => {
  for (const event of ['pointermove', 'wheel', 'scroll', 'visibilitychange', 'focus']) {
    assert.ok(
      !new RegExp(`addEventListener\\(['"]${event}['"]`).test(source),
      `${event} must not be wired to the score`,
    )
  }
  assert.ok(!/setInterval\([^)]*start/.test(source), 'no retry timer starts the audio')
})

test('the AudioContext is created once, from the click path', () => {
  const creations = source.match(/new Ctor\(\)/g) ?? []
  assert.equal(creations.length, 1, 'a second AudioContext would double the score')
})
