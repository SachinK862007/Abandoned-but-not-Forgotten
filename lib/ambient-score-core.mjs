// Shared constants and gain maths for the homepage ambient score.
//
// The score is silent until the visitor deliberately starts it, so the default
// state is *off*: the first click plays, the next mutes, the one after resumes.
// Keeping the numbers here lets the component and the tests agree on them.

/** Full application level — quality is protected by the limiter, not a cap. */
export const MAX_GAIN = 1

/** The score starts silent and only a real gesture turns it on. */
export const DEFAULT_ENABLED = false

export const DEFAULT_VOLUME = 100

export function clampVolume(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_VOLUME
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

/**
 * Master gain for the current state. A muted score is exact silence, whatever
 * the slider says, so changing the volume can never start playback.
 */
export function targetGain(volume, enabled) {
  if (!enabled) return 0
  return (clampVolume(volume) / 100) * MAX_GAIN
}
