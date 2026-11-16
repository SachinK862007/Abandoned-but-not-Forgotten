'use client'

import { ChevronUp, Music2, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Home-page ambient score with volume control.
 *
 * The music itself is unchanged: four slowly breathing pad voices and a sparse
 * bell figure, all generated with the Web Audio API. No audio file is
 * downloaded and nothing copyrighted is reproduced.
 *
 * Behaviour:
 *   • 100% is the full application level (no hidden 40% multiplier). A limiter
 *     sits before the destination so a full mix cannot clip.
 *   • Hovering or keyboard-focusing the button reveals a compact volume slider.
 *   • Clicking the button fades the master gain to zero over ~1.3 s and only
 *     then suspends the AudioContext; the oscillators are never cut mid-note.
 *   • Unmuting resumes the same graph and fades back to the stored volume.
 *   • The chosen volume is remembered in localStorage.
 *   • Music starts automatically on every visit to "/" (browsers still need a
 *     gesture once, so the score is armed and unlocks on the first interaction,
 *     on focus and on a slow retry). The component only exists on "/" —
 *     leaving the homepage tears it down, and coming back starts it again.
 */

const STORAGE_KEY = 'space-relics:volume'
const DEFAULT_VOLUME = 100
/** 100% maps to unity gain; quality is protected by the limiter, not a cap. */
const MAX_GAIN = 1
const FADE_IN_SECONDS = 1
const FADE_OUT_SECONDS = 1.3
const SUSPEND_AFTER_MS = Math.round(FADE_OUT_SECONDS * 1000) + 120

const clampVolume = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

export default function AmbientScore() {
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const sourcesRef = useRef<OscillatorNode[]>([])
  const noteTimerRef = useRef<number | null>(null)
  const suspendTimerRef = useRef<number | null>(null)
  const enabledRef = useRef(true)
  const volumeRef = useRef(DEFAULT_VOLUME)

  const [enabled, setEnabled] = useState(true)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)

  const open = hovered || pinned

  const clearSuspendTimer = useCallback(() => {
    if (suspendTimerRef.current !== null) {
      window.clearTimeout(suspendTimerRef.current)
      suspendTimerRef.current = null
    }
  }, [])

  /**
   * Ramps the master gain from its current value to `target` over `seconds`.
   * Cancels any earlier automation first, so rapid clicks never stack ramps.
   */
  const ramp = useCallback((target: number, seconds: number) => {
    const ctx = ctxRef.current
    const master = masterRef.current
    if (!ctx || !master) return
    const now = ctx.currentTime
    const gain = master.gain
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(now)
    } else {
      const current = gain.value
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(current, now)
    }
    if (seconds <= 0) {
      gain.setValueAtTime(target, now)
      return
    }
    gain.linearRampToValueAtTime(target, now + seconds)
  }, [])

  const stop = useCallback(() => {
    clearSuspendTimer()
    if (noteTimerRef.current !== null) {
      window.clearInterval(noteTimerRef.current)
      noteTimerRef.current = null
    }
    for (const source of sourcesRef.current) {
      try {
        source.stop()
        source.disconnect()
      } catch {
        // already stopped
      }
    }
    sourcesRef.current = []
    const ctx = ctxRef.current
    ctxRef.current = null
    masterRef.current = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
  }, [clearSuspendTimer])

  const start = useCallback(() => {
    const existing = ctxRef.current
    if (existing) {
      void existing.resume().catch(() => undefined)
      return
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    const ctx = new Ctor()

    // Safety limiter: protects audio quality at 100% instead of capping volume.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -4
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    limiter.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(limiter)
    masterRef.current = master
    ctxRef.current = ctx

    // Soft, dark tone with a long tail.
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 640
    filter.Q.value = 0.7
    filter.connect(master)

    const delay = ctx.createDelay(2)
    delay.delayTime.value = 0.52
    const feedback = ctx.createGain()
    feedback.gain.value = 0.3
    const wet = ctx.createGain()
    wet.gain.value = 0.3
    filter.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(wet)
    wet.connect(master)

    // ---- pad: four slowly breathing voices --------------------------------
    const padFrequencies = [110, 164.81, 220, 329.63]
    padFrequencies.forEach((frequency, index) => {
      const osc = ctx.createOscillator()
      osc.type = index % 2 === 0 ? 'sine' : 'triangle'
      osc.frequency.value = frequency
      osc.detune.value = (index - 1.5) * 7

      const gain = ctx.createGain()
      gain.gain.value = 0.045

      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.04 + index * 0.016
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.03
      lfo.connect(lfoGain)
      lfoGain.connect(gain.gain)

      osc.connect(gain)
      gain.connect(filter)
      osc.start()
      lfo.start()
      sourcesRef.current.push(osc, lfo)
    })

    // ---- sparse bell figure ------------------------------------------------
    const scale = [440, 493.88, 554.37, 659.25, 739.99, 880]
    let step = 0
    const playNote = () => {
      const active = ctxRef.current
      if (!active) return
      const now = active.currentTime
      const osc = active.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = scale[step % scale.length]
      step += 1 + (step % 3)

      const gain = active.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.05, now + 1.1)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.4)

      osc.connect(gain)
      gain.connect(filter)
      osc.start(now)
      osc.stop(now + 5.6)
    }
    noteTimerRef.current = window.setInterval(playNote, 2900)

    const target = enabledRef.current ? (volumeRef.current / 100) * MAX_GAIN : 0
    master.gain.linearRampToValueAtTime(target, ctx.currentTime + 2.2)
    void ctx.resume().catch(() => undefined)
  }, [])

  const toggle = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) {
      enabledRef.current = true
      setEnabled(true)
      start()
      return
    }

    clearSuspendTimer()

    if (enabledRef.current) {
      // Fade first, suspend only after the tail has reached zero.
      enabledRef.current = false
      setEnabled(false)
      ramp(0, FADE_OUT_SECONDS)
      suspendTimerRef.current = window.setTimeout(() => {
        suspendTimerRef.current = null
        if (enabledRef.current) return
        const active = ctxRef.current
        if (active && active.state === 'running') void active.suspend().catch(() => undefined)
      }, SUSPEND_AFTER_MS)
      return
    }

    enabledRef.current = true
    setEnabled(true)
    const target = (volumeRef.current / 100) * MAX_GAIN
    void ctx
      .resume()
      .then(() => ramp(target, FADE_IN_SECONDS))
      .catch(() => ramp(target, 0))
  }, [clearSuspendTimer, ramp, start])

  const changeVolume = useCallback(
    (next: number) => {
      const value = clampVolume(next)
      volumeRef.current = value
      setVolume(value)
      try {
        window.localStorage.setItem(STORAGE_KEY, String(value))
      } catch {
        // Storage can be blocked (private mode); the session still works.
      }
      // Changing volume while muted only records the preference.
      if (enabledRef.current) ramp((value / 100) * MAX_GAIN, 0.08)
    },
    [ramp],
  )

  // Restore the saved preference after hydration (server and client both render
  // 100% first, so there is no mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) return
      const value = clampVolume(parsed)
      volumeRef.current = value
      setVolume(value)
    } catch {
      // ignore
    }
  }, [])

  // Autoplay: the score should be playing whenever somebody arrives on the home
  // page. Browsers refuse to start audio without engagement, so this tries
  // immediately, then unlocks on the first gesture of any kind, again when the
  // tab is brought back, and on a slow retry — and it stays armed, so the music
  // always ends up playing unless the visitor muted it here.
  useEffect(() => {
    let cancelled = false

    const unlock = () => {
      if (cancelled || !enabledRef.current) return
      const ctx = ctxRef.current
      if (!ctx) {
        start()
        return
      }
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    }

    unlock()

    const gestures = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    for (const type of gestures) window.addEventListener(type, unlock, { passive: true })
    window.addEventListener('focus', unlock)
    document.addEventListener('visibilitychange', unlock)

    const retry = window.setInterval(() => {
      const ctx = ctxRef.current
      if (!ctx || ctx.state !== 'running') unlock()
    }, 2500)

    return () => {
      cancelled = true
      for (const type of gestures) window.removeEventListener(type, unlock)
      window.removeEventListener('focus', unlock)
      document.removeEventListener('visibilitychange', unlock)
      window.clearInterval(retry)
    }
  }, [start])

  useEffect(() => stop, [stop])

  return (
    <div
      className="fixed bottom-5 right-5 z-40 flex flex-col items-end"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false)
      }}
    >
      {/* Volume panel: stays attached to the button, revealed on hover/focus or
          pinned on touch. The bottom padding bridges the gap so moving the
          pointer from the icon to the slider never dismisses it. */}
      <div
        id="ambient-score-volume"
        className={`absolute bottom-full right-0 pb-2 transition-all duration-200 ease-out motion-reduce:transition-none ${
          open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 rounded-full border border-orbit/30 bg-void/80 px-3 py-2 text-moon shadow-lg backdrop-blur">
          <Volume2 className="size-3.5 shrink-0 text-moon/80" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            tabIndex={open ? 0 : -1}
            aria-label="Ambient score volume"
            aria-valuetext={`${volume} percent`}
            className="h-4 w-24 cursor-pointer accent-electric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70"
          />
          <span className="w-9 text-right font-display text-[10px] tabular-nums tracking-[0.08em] text-moon">
            {volume}%
          </span>
        </div>
      </div>

      {/* Touch devices have no hover: a small chevron reveals the slider without
          touching the mute action. Hidden wherever hovering is possible. */}
      <button
        type="button"
        onClick={() => setPinned((value) => !value)}
        aria-expanded={open}
        aria-controls="ambient-score-volume"
        aria-label={open ? 'Hide volume control' : 'Show volume control'}
        className="mb-2 hidden size-7 items-center justify-center rounded-full border border-orbit/30 bg-void/70 text-moon backdrop-blur transition-colors hover:border-electric/60 hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 [@media(hover:none)]:flex"
      >
        <ChevronUp className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label={enabled ? 'Mute ambient score' : 'Play ambient score'}
        title={`Ambient score · ${volume}%`}
        className="flex size-10 items-center justify-center rounded-full border border-orbit/30 bg-void/70 text-moon backdrop-blur transition-colors hover:border-electric/60 hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-void"
      >
        {enabled ? <Music2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
