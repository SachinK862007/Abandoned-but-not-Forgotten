'use client'

import type * as ThreeTypes from 'three'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Relic } from '@/lib/types'

/**
 * Mission film: a short 3D cinematic generated in the browser from the relic's
 * own dataset values — the target body, the published landing coordinates, the
 * agency and the year. Nothing is fetched, nothing navigates away and no fact is
 * invented; the film is a visualisation of the record you are reading.
 *
 * Everything happens inside this card: poster → play → live three.js render.
 */

const DURATION = 9.4
const T_INBOUND = 1.1
const T_IMPACT = 3.7
const T_REVEAL = 4.7

const BODY_TEXTURE: Record<Relic['planet'], string> = {
  moon: '/space/textures/moon.jpg',
  mars: '/space/textures/mars.jpg',
}

const BODY_TINT: Record<Relic['planet'], number> = {
  moon: 0xb6c1d4,
  mars: 0xb4674a,
}

const BODY_LABEL: Record<Relic['planet'], string> = {
  moon: "Earth's Moon",
  mars: 'Mars',
}

const PHASE_LABEL = ['Approach', 'Terminal descent', 'Touchdown', 'Site locked'] as const

function easeInOut(x: number) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** Lat/lon → a point on a sphere (dataset coordinates, degrees). */
function surfacePoint(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  }
}

function fmtCoord(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`
}

export default function MissionFilm({
  relic,
  autoPlayToken = 0,
}: {
  relic: Relic
  autoPlayToken?: number
}) {
  const [active, setActive] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState(0)
  const [failed, setFailed] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const playingRef = useRef(false)
  const elapsedRef = useRef(0)

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  // A different mission selected: back to the poster.
  useEffect(() => {
    setActive(false)
    setPlaying(false)
    setProgress(0)
    setPhase(0)
    elapsedRef.current = 0
  }, [relic.id])

  // "Film" clicked on a list row: start this mission's film immediately.
  useEffect(() => {
    if (autoPlayToken === 0) return
    setActive(true)
    setPlaying(true)
  }, [autoPlayToken])

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return

    let disposed = false
    let raf = 0
    let teardown: (() => void) | null = null

    const boot = async () => {
      const THREE = await import('three')
      if (disposed) return

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
      renderer.outputColorSpace = THREE.SRGBColorSpace

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120)
      const world = new THREE.Group()
      scene.add(world)

      // ---- body -------------------------------------------------------------
      const loader = new THREE.TextureLoader()
      const map = await new Promise<ThreeTypes.Texture | null>((resolve) => {
        loader.load(BODY_TEXTURE[relic.planet], (texture) => resolve(texture), undefined, () => resolve(null))
      })
      if (disposed) return
      if (map) map.colorSpace = THREE.SRGBColorSpace

      const bodyGeo = new THREE.SphereGeometry(1, 64, 64)
      const bodyMat = new THREE.MeshStandardMaterial({
        map: map ?? undefined,
        color: map ? 0xffffff : BODY_TINT[relic.planet],
        roughness: 0.96,
        metalness: 0,
      })
      world.add(new THREE.Mesh(bodyGeo, bodyMat))

      const key = new THREE.DirectionalLight(0xfff4e8, 2.4)
      key.position.set(2.6, 1.9, 2.4)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0x83b7ff, 1.1)
      rim.position.set(-2.6, -1.1, -1.9)
      scene.add(rim)
      scene.add(new THREE.AmbientLight(0x2a3352, 1.3))

      // ---- stars ------------------------------------------------------------
      const starCount = 900
      const starPositions = new Float32Array(starCount * 3)
      for (let i = 0; i < starCount; i += 1) {
        const r = 16 + (i % 8) * 4
        const u = Math.random() * 2 - 1
        const angle = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        starPositions[i * 3] = r * s * Math.cos(angle)
        starPositions[i * 3 + 1] = r * u
        starPositions[i * 3 + 2] = r * s * Math.sin(angle)
      }
      const starGeo = new THREE.BufferGeometry()
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
      const starMat = new THREE.PointsMaterial({
        color: 0xd6e6ff,
        size: 0.11,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      })
      scene.add(new THREE.Points(starGeo, starMat))

      // ---- landing site -----------------------------------------------------
      const site = surfacePoint(relic.latitude, relic.longitude, 1.004)
      const markerPos = new THREE.Vector3(site.x, site.y, site.z)

      // Turn the body so the documented site faces the camera, and only sway
      // from there so the site never rotates out of view.
      const baseYaw = -Math.atan2(markerPos.x, markerPos.z)
      world.rotation.y = baseYaw

      const markerGeo = new THREE.SphereGeometry(0.028, 20, 20)
      const markerMat = new THREE.MeshBasicMaterial({ color: 0x9ec8ff })
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.copy(markerPos)
      world.add(marker)

      const ringGeo = new THREE.RingGeometry(0.046, 0.062, 56)
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x9ec8ff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.copy(markerPos)
      ring.lookAt(markerPos.clone().multiplyScalar(4))
      world.add(ring)

      // ---- descent track ----------------------------------------------------
      const start = new THREE.Vector3(0.85, 0.95, 3.15)
      const control = markerPos.clone().normalize().multiplyScalar(2.0).add(new THREE.Vector3(0, 0.55, 0))
      const curve = new THREE.QuadraticBezierCurve3(start, control, markerPos.clone().multiplyScalar(1.02))

      const trailGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72))
      const trailMat = new THREE.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0 })
      world.add(new THREE.Line(trailGeo, trailMat))

      const probeGeo = new THREE.SphereGeometry(0.026, 16, 16)
      const probeMat = new THREE.MeshBasicMaterial({ color: 0xf4f9ff })
      const probe = new THREE.Mesh(probeGeo, probeMat)
      probe.visible = false
      world.add(probe)

      // ---- framing ----------------------------------------------------------
      const orbit = { theta: 0, phi: 0.14, radius: 4.6 }
      const place = () => {
        const cosPhi = Math.cos(orbit.phi)
        camera.position.set(
          Math.sin(orbit.theta) * cosPhi * orbit.radius,
          Math.sin(orbit.phi) * orbit.radius,
          Math.cos(orbit.theta) * cosPhi * orbit.radius,
        )
        camera.lookAt(0, 0, 0)
      }

      const resize = () => {
        const w = stage.clientWidth
        const h = stage.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(stage)
      resize()

      // ---- interaction: drag to look around ---------------------------------
      let dragging = false
      let lastX = 0
      let lastY = 0
      const onDown = (event: PointerEvent) => {
        dragging = true
        lastX = event.clientX
        lastY = event.clientY
        canvas.setPointerCapture?.(event.pointerId)
      }
      const onMove = (event: PointerEvent) => {
        if (!dragging) return
        orbit.theta -= (event.clientX - lastX) * 0.006
        orbit.phi = Math.max(-0.85, Math.min(1.05, orbit.phi + (event.clientY - lastY) * 0.004))
        lastX = event.clientX
        lastY = event.clientY
      }
      const onUp = (event: PointerEvent) => {
        dragging = false
        canvas.releasePointerCapture?.(event.pointerId)
      }
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointercancel', onUp)

      // ---- loop -------------------------------------------------------------
      let last = performance.now()
      let lastPct = -1
      let lastPhase = -1

      const loop = () => {
        if (disposed) return
        const now = performance.now()
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now

        if (playingRef.current) {
          elapsedRef.current = Math.min(DURATION, elapsedRef.current + dt)
          if (elapsedRef.current >= DURATION) {
            playingRef.current = false
            setPlaying(false)
          }
        }
        const t = elapsedRef.current

        const targetRadius = t < T_INBOUND ? 4.6 - 1.05 * (t / T_INBOUND) : t < T_IMPACT ? 3.55 : 2.95
        orbit.radius += (targetRadius - orbit.radius) * Math.min(1, dt * 2.4)
        orbit.theta += 0.0006 * (dragging ? 0 : 1)
        place()

        world.rotation.y = baseYaw + Math.sin(t * 0.16) * 0.12

        const inbound = Math.max(0, Math.min(1, (t - T_INBOUND) / (T_IMPACT - T_INBOUND)))
        trailMat.opacity = inbound > 0 ? 0.45 * (1 - inbound * 0.3) : 0
        probe.visible = inbound > 0 && inbound < 1
        if (probe.visible) probe.position.copy(curve.getPoint(easeInOut(inbound)))

        const sinceImpact = t - T_IMPACT
        if (sinceImpact > 0) {
          const cycle = (sinceImpact % 1.9) / 1.9
          ring.scale.setScalar(1 + cycle * 5.5)
          ringMat.opacity = 0.8 * (1 - cycle)
        } else {
          ringMat.opacity = 0
        }
        marker.scale.setScalar(1 + Math.sin(t * 6) * 0.12)

        const pct = Math.round((t / DURATION) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          setProgress(pct)
        }
        const nextPhase = t < T_INBOUND ? 0 : t < T_IMPACT ? 1 : t < T_REVEAL ? 2 : 3
        if (nextPhase !== lastPhase) {
          lastPhase = nextPhase
          setPhase(nextPhase)
        }

        renderer.render(scene, camera)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)

      teardown = () => {
        observer.disconnect()
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointercancel', onUp)
        starGeo.dispose()
        starMat.dispose()
        bodyGeo.dispose()
        bodyMat.dispose()
        map?.dispose()
        markerGeo.dispose()
        markerMat.dispose()
        ringGeo.dispose()
        ringMat.dispose()
        trailGeo.dispose()
        trailMat.dispose()
        probeGeo.dispose()
        probeMat.dispose()
        renderer.dispose()
      }
    }

    boot().catch(() => {
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      teardown?.()
    }
  }, [active, relic.id, relic.planet, relic.latitude, relic.longitude])

  const toggle = useCallback(() => {
    if (!active) {
      setActive(true)
      setPlaying(true)
      return
    }
    setPlaying((value) => !value)
  }, [active])

  const replay = useCallback(() => {
    elapsedRef.current = 0
    setProgress(0)
    setActive(true)
    setPlaying(true)
  }, [])

  const caption =
    phase === 0
      ? `${relic.agency} · ${relic.year}`
      : phase === 1
        ? `Descent · ${fmtCoord(relic.latitude, 'N', 'S')} ${fmtCoord(relic.longitude, 'E', 'W')}`
        : phase === 2
          ? 'Touchdown'
          : `${relic.kind} · site locked`

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-orbit/25 bg-void/60">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <p className="font-display text-[9px] uppercase tracking-[0.24em] text-electric">Mission film</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-moon/45">
          {BODY_LABEL[relic.planet]} · generated
        </p>
      </div>

      <div ref={stageRef} className="relative mt-2 aspect-[16/9] w-full overflow-hidden bg-[#05060f]">
        {active ? (
          <canvas ref={canvasRef} className="size-full cursor-grab touch-none active:cursor-grabbing" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(120%_120%_at_50%_120%,#1a2340_0%,#05060f_65%)]">
            <p className="px-6 text-center font-display text-[11px] uppercase tracking-[0.2em] text-starlight/90">
              {relic.name}
            </p>
            <button
              type="button"
              onClick={toggle}
              className="group flex items-center gap-2 rounded-full border border-electric/40 bg-electric/10 px-4 py-2 font-display text-[10px] uppercase tracking-[0.2em] text-starlight transition-all hover:border-electric/80 hover:bg-electric/20 hover:shadow-[0_0_28px_rgba(131,183,255,0.3)]"
            >
              <Play className="size-3.5" aria-hidden />
              Play film
            </button>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-moon/40">≈ 9 s · plays here</p>
          </div>
        )}

        {active && !failed && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-void/80 to-transparent p-2.5">
            <span className="font-display text-[9px] uppercase tracking-[0.2em] text-starlight/90">
              {PHASE_LABEL[phase]}
            </span>
            <span className="max-w-[62%] text-right font-mono text-[9px] leading-relaxed text-moon/75">
              {caption}
            </span>
          </div>
        )}

        {active && failed && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            <p className="text-xs leading-relaxed text-moon/80">
              3D playback is unavailable on this device, so the mission record above stands as the source.
            </p>
          </div>
        )}

        {active && !failed && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-void/85 to-transparent p-2.5">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? 'Pause film' : 'Play film'}
              className="flex size-7 items-center justify-center rounded-full border border-orbit/40 bg-void/60 text-starlight transition-colors hover:border-electric/70"
            >
              {playing ? <Pause className="size-3" aria-hidden /> : <Play className="size-3" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={replay}
              aria-label="Replay film"
              className="flex size-7 items-center justify-center rounded-full border border-orbit/40 bg-void/60 text-moon transition-colors hover:border-electric/70 hover:text-starlight"
            >
              <RotateCcw className="size-3" aria-hidden />
            </button>
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-electric transition-[width] duration-150 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[9px] text-moon/55">{progress}%</span>
          </div>
        )}
      </div>

      <p className="px-3 py-2 text-[10px] leading-relaxed text-moon/50">
        Rendered live in your browser from this record&apos;s own NASA dataset values — coordinates, agency
        and year. Drag the scene to look around.
      </p>
    </div>
  )
}
