import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import { jsPDF } from 'jspdf'
import {
  RotateCcw, RotateCw, Maximize2, Sparkles, CheckCircle, X, Loader2, ScanLine, ZapOff,
  FileText, Image as ImageIcon, Palette, SlidersHorizontal, Crop
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
 *  CROP OVERLAY — Quadrilateral edition
 *  ─────────────
 *  High-performance crop UI:
 *    • Four corners stored as independent (x, y) — full quadrilateral, not
 *      a rectangle. Enables perspective skew correction.
 *    • Corners + 4 edge midpoints = 8 handles for precise adjustment
 *    • Edge midpoints translate the edge perpendicular to itself (both
 *      adjacent corners move together)
 *    • SVG-based overlay: polygon + grid + dim mask all in one vector layer
 *    • All hot-path updates written directly to DOM (no React re-renders)
 *    • requestAnimationFrame batches updates to one per frame
 *    • Pointer capture so drags stick when the pointer leaves a handle
 *    • Crop area sized to the image's actual rendered region (letter-box-safe)
 *    • Quadrilateral kept CONVEX during drag — corners cannot cross
 * ═══════════════════════════════════════════════════════════════════════════ */

// Default quadrilateral — slight inset from full frame
const DEFAULT_CORNERS = () => ({
  tl: { x: 0.04, y: 0.04 },
  tr: { x: 0.96, y: 0.04 },
  br: { x: 0.96, y: 0.96 },
  bl: { x: 0.04, y: 0.96 },
})

// Convert a rectangular box {x,y,x2,y2} to a quadrilateral
const boxToCorners = (b) => ({
  tl: { x: b.x,  y: b.y  },
  tr: { x: b.x2, y: b.y  },
  br: { x: b.x2, y: b.y2 },
  bl: { x: b.x,  y: b.y2 },
})

// Sign of cross product for vectors AB and AC — determines which side of
// line AB the point C lies on. Used to keep the quad convex during drags.
const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

function CropOverlay({ imageUrl, onApply, onSkip, onRotate, onDetect }) {
  const wrapRef = useRef(null)          // fills viewport, measures for letterbox math
  const imageAreaRef = useRef(null)     // sized to image's rendered area; receives pointer capture
  const polyRef = useRef(null)          // <polygon> outline
  const maskRef = useRef(null)          // <path> creating the dim-outside mask
  const gridRef = useRef(null)          // <g> rule-of-thirds lines clipped to polygon
  const handleRefs = useRef({})         // { tl, tr, br, bl, t, r, b, l } → DOM nodes
  const imgRef = useRef(null)
  const cornersRef = useRef(DEFAULT_CORNERS())
  const dragStateRef = useRef(null)     // { handle, start, startCorners }
  const rafRef = useRef(null)

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 })

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  const MIN_DIM = 0.05  // min distance between adjacent corners

  // ── Compute visible image rect inside the wrap (object-contain math) ──────
  const area = (() => {
    const W = wrapSize.w, H = wrapSize.h, iw = imgSize.w, ih = imgSize.h
    if (!W || !H || !iw || !ih) return { x: 0, y: 0, w: W || 0, h: H || 0 }
    const imgA = iw / ih
    const wrapA = W / H
    let dw, dh
    if (imgA > wrapA) { dw = W; dh = W / imgA }
    else              { dh = H; dw = H * imgA }
    return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh }
  })()

  // ── Direct-to-DOM writer ──────────────────────────────────────────────────
  // Writes polygon points, mask path, grid lines, and handle positions.
  // Coordinates expressed in 0-100 (percent of imageArea) for the SVG, which
  // uses viewBox="0 0 100 100" so SVG units == percent of the image rect.
  const applyToDOM = () => {
    const c = cornersRef.current
    const pts = `${c.tl.x * 100},${c.tl.y * 100} ${c.tr.x * 100},${c.tr.y * 100} ${c.br.x * 100},${c.br.y * 100} ${c.bl.x * 100},${c.bl.y * 100}`

    if (polyRef.current) {
      polyRef.current.setAttribute('points', pts)
    }
    if (maskRef.current) {
      // Outer rect minus inner polygon (even-odd fill)
      const d =
        `M0,0 L100,0 L100,100 L0,100 Z ` +
        `M${c.tl.x * 100},${c.tl.y * 100} ` +
        `L${c.bl.x * 100},${c.bl.y * 100} ` +
        `L${c.br.x * 100},${c.br.y * 100} ` +
        `L${c.tr.x * 100},${c.tr.y * 100} Z`
      maskRef.current.setAttribute('d', d)
    }
    // Rule-of-thirds: 2 lines along each pair of opposing edges
    if (gridRef.current) {
      const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      const lines = []
      for (const t of [1/3, 2/3]) {
        // horizontal-ish: from lerp(tl,bl,t) to lerp(tr,br,t)
        const a = lerp(c.tl, c.bl, t)
        const b = lerp(c.tr, c.br, t)
        lines.push(`M${a.x * 100},${a.y * 100} L${b.x * 100},${b.y * 100}`)
        // vertical-ish: from lerp(tl,tr,t) to lerp(bl,br,t)
        const c1 = lerp(c.tl, c.tr, t)
        const d1 = lerp(c.bl, c.br, t)
        lines.push(`M${c1.x * 100},${c1.y * 100} L${d1.x * 100},${d1.y * 100}`)
      }
      gridRef.current.setAttribute('d', lines.join(' '))
    }
    // Position handles (in % of imageArea)
    const writeHandle = (key, x, y) => {
      const el = handleRefs.current[key]
      if (!el) return
      el.style.left = (x * 100) + '%'
      el.style.top  = (y * 100) + '%'
    }
    writeHandle('tl', c.tl.x, c.tl.y)
    writeHandle('tr', c.tr.x, c.tr.y)
    writeHandle('br', c.br.x, c.br.y)
    writeHandle('bl', c.bl.x, c.bl.y)
    writeHandle('t',  (c.tl.x + c.tr.x) / 2, (c.tl.y + c.tr.y) / 2)
    writeHandle('r',  (c.tr.x + c.br.x) / 2, (c.tr.y + c.br.y) / 2)
    writeHandle('b',  (c.bl.x + c.br.x) / 2, (c.bl.y + c.br.y) / 2)
    writeHandle('l',  (c.tl.x + c.bl.x) / 2, (c.tl.y + c.bl.y) / 2)
  }

  const scheduleUpdate = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      applyToDOM()
    })
  }

  useLayoutEffect(() => { applyToDOM() })

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setWrapSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // ── Animate corners to a new quad (used by auto-detect) ──────────────────
  const animateTo = (target) => {
    const start = cornersRef.current
    const startT = performance.now()
    const dur = 220
    const ease = (t) => 1 - Math.pow(1 - t, 3)
    const step = () => {
      const t = Math.min(1, (performance.now() - startT) / dur)
      const k = ease(t)
      const lerp = (a, b) => a + (b - a) * k
      cornersRef.current = {
        tl: { x: lerp(start.tl.x, target.tl.x), y: lerp(start.tl.y, target.tl.y) },
        tr: { x: lerp(start.tr.x, target.tr.x), y: lerp(start.tr.y, target.tr.y) },
        br: { x: lerp(start.br.x, target.br.x), y: lerp(start.br.y, target.br.y) },
        bl: { x: lerp(start.bl.x, target.bl.x), y: lerp(start.bl.y, target.bl.y) },
      }
      applyToDOM()
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // Auto-detect — returns boolean for whether anything was found
  const runAutoDetect = () => {
    if (!onDetect) return false
    const detected = onDetect()
    if (!detected) return false
    // Detector may return either a rectangle {x,y,x2,y2} OR a quad {tl,tr,br,bl}
    const target = detected.tl ? detected : boxToCorners(detected)
    animateTo(target)
    return true
  }

  const onImgLoad = () => {
    const img = imgRef.current
    if (!img) return
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    const detected = onDetect ? onDetect() : null
    if (detected) {
      cornersRef.current = detected.tl ? detected : boxToCorners(detected)
    } else {
      cornersRef.current = DEFAULT_CORNERS()
    }
    applyToDOM()
  }

  // ── Pointer helpers ───────────────────────────────────────────────────────
  const getRel = (e) => {
    const rect = imageAreaRef.current.getBoundingClientRect()
    return {
      x: clamp((e.clientX - rect.left) / rect.width,  0, 1),
      y: clamp((e.clientY - rect.top)  / rect.height, 0, 1),
    }
  }

  const onPointerDown = (handle) => (e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragStateRef.current = {
      handle,
      start: getRel(e),
      startCorners: JSON.parse(JSON.stringify(cornersRef.current)),
      pointerId: e.pointerId,
    }
    try { imageAreaRef.current?.setPointerCapture(e.pointerId) } catch {}
  }

  // Set one corner subject to:
  //  (a) it stays in [0, 1]
  //  (b) minimum spacing from each neighbour
  //  (c) the quadrilateral stays simple (non-self-intersecting). Achieved by
  //      keeping the new corner on the opposite side of the diagonal between
  //      its two neighbours from the opposite-corner — i.e. the polygon
  //      remains convex at this vertex.
  const setCorner = (key, nx, ny) => {
    const c = cornersRef.current
    const order = ['tl', 'tr', 'br', 'bl']  // CW
    const i = order.indexOf(key)
    const prev = c[order[(i + 3) % 4]] // CCW neighbour
    const next = c[order[(i + 1) % 4]] // CW  neighbour
    const opp  = c[order[(i + 2) % 4]] // diagonal corner

    // Reference sign: the OLD corner is on a specific side of line prev→next.
    // That's the side opposite from `opp` for a convex quad. We require the
    // NEW position to be on the same side.
    const refSign = Math.sign(cross(prev.x, prev.y, next.x, next.y, c[key].x, c[key].y))
    const oppSign = Math.sign(cross(prev.x, prev.y, next.x, next.y, opp.x, opp.y))

    let x = clamp(nx, 0, 1)
    let y = clamp(ny, 0, 1)

    // Convexity: walk toward `opp`'s reflection if the new point crossed the
    // diagonal. (A tiny inward step a few times converges quickly.)
    let tries = 0
    while (tries < 12) {
      const sNew = Math.sign(cross(prev.x, prev.y, next.x, next.y, x, y))
      // If signs agree with refSign (or zero), we're good. Otherwise nudge
      // perpendicular to the diagonal back toward the correct side.
      if (sNew === 0 || sNew === refSign || refSign === 0) break
      // Nudge: project current point onto the diagonal then push 2% further
      // back toward refSign-side.
      const ex = next.x - prev.x, ey = next.y - prev.y
      const len2 = ex * ex + ey * ey || 1e-9
      const t = ((x - prev.x) * ex + (y - prev.y) * ey) / len2
      const fx = prev.x + ex * t
      const fy = prev.y + ey * t
      // The diagonal is between fx,fy and our point. Move past fx,fy in the
      // direction of refSign:
      const nrmx = -ey, nrmy = ex
      const sgn = refSign * Math.sign(cross(prev.x, prev.y, next.x, next.y, fx + nrmx, fy + nrmy))
      const dir = sgn >= 0 ? 1 : -1
      x = fx + nrmx * 0.02 * dir
      y = fy + nrmy * 0.02 * dir
      x = clamp(x, 0, 1); y = clamp(y, 0, 1)
      tries++
    }

    // Minimum spacing from each neighbour
    const distSq = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2
    if (distSq(x, y, prev.x, prev.y) < MIN_DIM * MIN_DIM) {
      const d = Math.sqrt(distSq(x, y, prev.x, prev.y)) || 1e-6
      const k = MIN_DIM / d
      x = prev.x + (x - prev.x) * k
      y = prev.y + (y - prev.y) * k
    }
    if (distSq(x, y, next.x, next.y) < MIN_DIM * MIN_DIM) {
      const d = Math.sqrt(distSq(x, y, next.x, next.y)) || 1e-6
      const k = MIN_DIM / d
      x = next.x + (x - next.x) * k
      y = next.y + (y - next.y) * k
    }

    c[key].x = x
    c[key].y = y
    // Mark `oppSign` used so the linter doesn't complain — it's intentionally
    // captured for clarity but the algorithm uses `refSign`.
    void oppSign
  }

  const onPointerMove = (e) => {
    const d = dragStateRef.current
    if (!d) return
    e.preventDefault()
    const pos = getRel(e)
    const dx = pos.x - d.start.x
    const dy = pos.y - d.start.y
    const sc = d.startCorners

    switch (d.handle) {
      case 'tl': setCorner('tl', sc.tl.x + dx, sc.tl.y + dy); break
      case 'tr': setCorner('tr', sc.tr.x + dx, sc.tr.y + dy); break
      case 'br': setCorner('br', sc.br.x + dx, sc.br.y + dy); break
      case 'bl': setCorner('bl', sc.bl.x + dx, sc.bl.y + dy); break

      // Edge midpoints: translate both adjacent corners perpendicular to the
      // edge. Project drag onto the edge normal so the edge moves rigidly.
      case 't': case 'r': case 'b': case 'l': {
        const pairMap = { t: ['tl', 'tr'], r: ['tr', 'br'], b: ['bl', 'br'], l: ['tl', 'bl'] }
        const [a, bk] = pairMap[d.handle]
        const ax = sc[a].x, ay = sc[a].y
        const bx = sc[bk].x, by = sc[bk].y
        // Edge direction (normalised)
        const ex = bx - ax, ey = by - ay
        const len = Math.sqrt(ex * ex + ey * ey) || 1e-6
        const tx = ex / len, ty = ey / len
        // Project drag (dx, dy) onto edge normal (-ty, tx)
        const nx = -ty, ny = tx
        const dot = dx * nx + dy * ny
        const mx = nx * dot
        const my = ny * dot
        setCorner(a,  sc[a].x  + mx, sc[a].y  + my)
        setCorner(bk, sc[bk].x + mx, sc[bk].y + my)
        break
      }

      case 'body': {
        // Translate all 4 corners, clamping so the whole quad stays in [0,1]
        const minX = Math.min(sc.tl.x, sc.tr.x, sc.br.x, sc.bl.x)
        const minY = Math.min(sc.tl.y, sc.tr.y, sc.br.y, sc.bl.y)
        const maxX = Math.max(sc.tl.x, sc.tr.x, sc.br.x, sc.bl.x)
        const maxY = Math.max(sc.tl.y, sc.tr.y, sc.br.y, sc.bl.y)
        const cx = clamp(dx, -minX, 1 - maxX)
        const cy = clamp(dy, -minY, 1 - maxY)
        const c = cornersRef.current
        c.tl.x = sc.tl.x + cx; c.tl.y = sc.tl.y + cy
        c.tr.x = sc.tr.x + cx; c.tr.y = sc.tr.y + cy
        c.br.x = sc.br.x + cx; c.br.y = sc.br.y + cy
        c.bl.x = sc.bl.x + cx; c.bl.y = sc.bl.y + cy
        break
      }
      default: return
    }
    scheduleUpdate()
  }

  const onPointerUp = (e) => {
    const d = dragStateRef.current
    dragStateRef.current = null
    if (d) {
      try { imageAreaRef.current?.releasePointerCapture(d.pointerId) } catch {}
    }
  }

  const reset = () => {
    animateTo(DEFAULT_CORNERS())
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={wrapRef} className="flex-1 relative overflow-hidden bg-black select-none">
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          onLoad={onImgLoad}
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />

        <div
          ref={imageAreaRef}
          className="absolute"
          style={{
            left: area.x, top: area.y, width: area.w, height: area.h,
            touchAction: 'none',
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* SVG overlay: mask (dim outside), polygon (body drag + stroke), grid */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ touchAction: 'none' }}
          >
            <path
              ref={maskRef}
              d=""
              fill="rgba(0,0,0,0.55)"
              fillRule="evenodd"
              style={{ pointerEvents: 'none' }}
            />
            <polygon
              ref={polyRef}
              points=""
              fill="rgba(0,0,0,0.001)"
              stroke="rgba(255,255,255,0.95)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'move', pointerEvents: 'all' }}
              onPointerDown={onPointerDown('body')}
            />
            <path
              ref={gridRef}
              d=""
              stroke="rgba(255,255,255,0.20)"
              strokeWidth="1"
              fill="none"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          </svg>

          {/* Corner handles */}
          {['tl', 'tr', 'br', 'bl'].map((key) => (
            <DraggableDot
              key={key}
              variant="corner"
              setRef={(el) => { handleRefs.current[key] = el }}
              onPointerDown={onPointerDown(key)}
            />
          ))}
          {/* Edge midpoint handles */}
          {['t', 'r', 'b', 'l'].map((key) => (
            <DraggableDot
              key={key}
              variant="edge"
              setRef={(el) => { handleRefs.current[key] = el }}
              onPointerDown={onPointerDown(key)}
            />
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="shrink-0 bg-black/90 px-4 pb-8 pt-3 border-t border-white/5">
        <div className="flex items-center justify-center gap-7 mb-3">
          <button
            onClick={() => onRotate(-90)}
            className="flex flex-col items-center gap-1 text-gray-300 active:scale-95 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <RotateCcw size={18} />
            </div>
            <span className="text-[10px] font-medium text-gray-500">Rotate L</span>
          </button>
          <button
            onClick={runAutoDetect}
            className="flex flex-col items-center gap-1 text-blue-300 active:scale-95 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <span className="text-[10px] font-medium text-blue-300">Auto</span>
          </button>
          <button
            onClick={reset}
            className="flex flex-col items-center gap-1 text-gray-300 active:scale-95 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <Maximize2 size={18} />
            </div>
            <span className="text-[10px] font-medium text-gray-500">Reset</span>
          </button>
          <button
            onClick={() => onRotate(90)}
            className="flex flex-col items-center gap-1 text-gray-300 active:scale-95 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <RotateCw size={18} />
            </div>
            <span className="text-[10px] font-medium text-gray-500">Rotate R</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm font-semibold text-gray-300 active:scale-95 transition-transform"
          >
            Skip
          </button>
          <button
            onClick={() => onApply({ ...cornersRef.current })}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white active:scale-95 transition-transform"
          >
            <Crop size={15} />
            Apply Crop
          </button>
        </div>
      </div>
    </div>
  )
}

// One draggable dot — used for all 8 handles. Centered on its (left, top)
// position; corners and midpoints just differ visually (size / fill).
function DraggableDot({ variant, setRef, onPointerDown }) {
  const isCorner = variant === 'corner'
  const touchSize = isCorner ? 44 : 36
  const dotSize   = isCorner ? 18 : 12

  return (
    <div
      ref={setRef}
      onPointerDown={onPointerDown}
      className="absolute z-10 flex items-center justify-center"
      style={{
        width: touchSize,
        height: touchSize,
        marginLeft: -touchSize / 2,
        marginTop:  -touchSize / 2,
        touchAction: 'none',
        cursor: isCorner ? 'grab' : 'grab',
      }}
    >
      <div
        className="rounded-full bg-white"
        style={{
          width: dotSize,
          height: dotSize,
          boxShadow: '0 0 0 2px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.4)',
          border: isCorner ? '2px solid rgba(59,130,246,0.95)' : '2px solid rgba(255,255,255,0.85)',
          opacity: isCorner ? 1 : 0.92,
        }}
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  IMAGE PROCESSING PIPELINE
 *  ─────────────────────────
 *  1.  RGBA → Grayscale (Rec. 601 luminance)
 *  2.  Illumination map via downscale-max-upscale (a.k.a. shading estimate)
 *  3.  Flat-field correction (divide by illumination, target white = 240)
 *  4.  Per-mode output:
 *        BW    → Sauvola adaptive binarization (preserves thin strokes)
 *        GRAY  → Illumination-corrected, contrast-stretched grayscale
 *        COLOR → RGB channels corrected by same factor (shadow-free color)
 *        PHOTO → untouched JPEG
 *  5.  Brightness / contrast / threshold adjustments applied last.
 *
 *  Integral images and typed arrays keep the full pipeline < 500ms on a
 *  1600px-wide capture on mid-range mobile hardware.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── Grayscale ───────────────────────────────────────────────────────────────
function toGrayscale(data, len) {
  const gray = new Uint8ClampedArray(len)
  for (let i = 0; i < len; i++) {
    const p = i * 4
    gray[i] = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8
  }
  return gray
}

// ── Illumination estimate via downscale-max-upscale ─────────────────────────
//    Each block in the downscale takes the MAX — this gives us "what paper
//    would be" at that location, even if text (dark pixels) is present.
//    Upscaling back with bilinear interpolation produces a smooth illumination
//    map — no heavy convolution required.
function estimateIllumination(gray, w, h) {
  const smallW = 48
  const smallH = Math.max(8, Math.round((h / w) * smallW))
  const small = new Uint8ClampedArray(smallW * smallH)
  const sx = w / smallW
  const sy = h / smallH

  for (let by = 0; by < smallH; by++) {
    const y0 = (by * sy) | 0
    const y1 = Math.min(h, ((by + 1) * sy) | 0)
    for (let bx = 0; bx < smallW; bx++) {
      const x0 = (bx * sx) | 0
      const x1 = Math.min(w, ((bx + 1) * sx) | 0)
      let maxV = 0
      for (let y = y0; y < y1; y++) {
        const rowOff = y * w
        for (let x = x0; x < x1; x++) {
          const v = gray[rowOff + x]
          if (v > maxV) maxV = v
        }
      }
      small[by * smallW + bx] = maxV
    }
  }

  // Bilinear upscale back to (w, h)
  const out = new Uint8ClampedArray(w * h)
  const fxStep = (smallW - 1) / Math.max(1, w - 1)
  const fyStep = (smallH - 1) / Math.max(1, h - 1)
  for (let y = 0; y < h; y++) {
    const fy = y * fyStep
    const y0 = fy | 0
    const y1 = Math.min(smallH - 1, y0 + 1)
    const wy = fy - y0
    const row0 = y0 * smallW
    const row1 = y1 * smallW
    for (let x = 0; x < w; x++) {
      const fx = x * fxStep
      const x0 = fx | 0
      const x1 = Math.min(smallW - 1, x0 + 1)
      const wx = fx - x0
      const a = small[row0 + x0]
      const b = small[row0 + x1]
      const c = small[row1 + x0]
      const d = small[row1 + x1]
      const top = a + (b - a) * wx
      const bot = c + (d - c) * wx
      out[y * w + x] = (top + (bot - top) * wy) | 0
    }
  }
  return out
}

// ── Apply flat-field correction to grayscale channel ────────────────────────
function correctGray(gray, illum, len, target = 240) {
  const out = new Uint8ClampedArray(len)
  for (let i = 0; i < len; i++) {
    const il = illum[i] < 1 ? 1 : illum[i]
    const v = (gray[i] * target / il) | 0
    out[i] = v > 255 ? 255 : v
  }
  return out
}

// ── Apply flat-field correction to all RGB channels (color mode) ────────────
function correctColor(data, illum, len, target = 240) {
  for (let i = 0; i < len; i++) {
    const il = illum[i] < 1 ? 1 : illum[i]
    const factor = target / il
    const p = i * 4
    let r = (data[p]     * factor) | 0
    let g = (data[p + 1] * factor) | 0
    let b = (data[p + 2] * factor) | 0
    data[p]     = r > 255 ? 255 : r
    data[p + 1] = g > 255 ? 255 : g
    data[p + 2] = b > 255 ? 255 : b
  }
}

// ── Otsu's method (used by Sauvola fallback / global binarization) ──────────
function otsuThreshold(gray) {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let bestT = 128, maxVar = 0, w0 = 0, mu0 = 0
  for (let t = 0; t < 256; t++) {
    w0 += hist[t]
    if (w0 === 0) continue
    const w1 = total - w0
    if (w1 === 0) break
    mu0 += t * hist[t]
    const u0 = mu0 / w0
    const u1 = (sum - mu0) / w1
    const v = w0 * w1 * (u0 - u1) ** 2
    if (v > maxVar) { maxVar = v; bestT = t }
  }
  return bestT
}

/* ── Automatic document edge detection ────────────────────────────────────────
 *  Four strategies are run; each yields a candidate box. We score every
 *  candidate by fill-density on a shared "document" mask AND penalise extreme
 *  aspect ratios — the highest-scoring valid box wins.
 *
 *  1. Sobel-gradient projection            (PRIMARY — best for clear edges)
 *     Compute Sobel gradient magnitude of a lightly-blurred grayscale.
 *     A pixel "belongs to document boundary" if its gradient exceeds the
 *     85th-percentile of all gradients. We project these onto rows / cols
 *     and locate the OUTERMOST significant peaks — those are the document
 *     edges. Robust to uneven lighting and dark backgrounds.
 *
 *  2. Background-colour sampling
 *     Sample the outer 5% border strips, take median + MAD (more robust
 *     than std dev). Mark any pixel differing from bg-median by > MAD·1.5
 *     as document. Apply morphological closing to fill text gaps before
 *     projecting.
 *
 *  3. Otsu on flat-field-corrected grayscale
 *     Same projection approach, but mask comes from Otsu after illumination
 *     correction. Closing applied here too.
 *
 *  4. Row/column derivative                (FALLBACK — even-toned paper)
 *     Original strategy — relies on a brightness step at the document edge.
 *
 *  Validation:
 *    • Box must cover 20–95 % of each axis
 *    • Aspect ratio must be 0.35–2.85 (rejects sliver false positives)
 *  Returns {x,y,x2,y2} normalised 0-1, or null if nothing is confident.
 * ────────────────────────────────────────────────────────────────────────── */

// ── 3×3 box blur (separable) — fast noise reduction before edge detection ───
function boxBlur3(src, w, h) {
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const off = y * w
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < w - 1 ? x + 1 : w - 1
      tmp[off + x] = (src[off + x0] + src[off + x] + src[off + x1]) / 3
    }
  }
  // vertical pass
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < h - 1 ? y + 1 : h - 1
    for (let x = 0; x < w; x++) {
      out[y * w + x] = (tmp[y0 * w + x] + tmp[y * w + x] + tmp[y1 * w + x]) / 3
    }
  }
  return out
}

// ── Sobel gradient magnitude (Uint16Array, peaks where edges are) ───────────
function sobelMagnitude(gray, w, h) {
  const mag = new Uint16Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1]
      const l  = gray[i - 1],     r  = gray[i + 1]
      const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1]
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr)
      // approximate magnitude
      const a = Math.abs(gx) + Math.abs(gy)
      mag[i] = a > 1020 ? 1020 : a // cap (4 * 255)
    }
  }
  return mag
}

// ── Morphological closing (3×3 dilation then erosion) — fills small gaps ────
function morphClose3(mask, w, h) {
  const len = w * h
  const dilated = new Uint8Array(len)
  // Dilation: any of 3×3 neighbours == 1 → 1
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < h - 1 ? y + 1 : h - 1
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < w - 1 ? x + 1 : w - 1
      let v = 0
      for (let yy = y0; yy <= y1 && !v; yy++) {
        for (let xx = x0; xx <= x1 && !v; xx++) {
          if (mask[yy * w + xx]) v = 1
        }
      }
      dilated[y * w + x] = v
    }
  }
  const eroded = new Uint8Array(len)
  // Erosion: ALL of 3×3 neighbours == 1 → 1
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < h - 1 ? y + 1 : h - 1
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < w - 1 ? x + 1 : w - 1
      let v = 1
      for (let yy = y0; yy <= y1 && v; yy++) {
        for (let xx = x0; xx <= x1 && v; xx++) {
          if (!dilated[yy * w + xx]) v = 0
        }
      }
      eroded[y * w + x] = v
    }
  }
  return eroded
}

function detectDocument(srcCanvas) {
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return null

  const MAX_W = 600   // bumped from 400 — gives gradient detection cleaner edges
  const ratio = Math.min(1, MAX_W / srcCanvas.width)
  const w = Math.max(1, Math.round(srcCanvas.width  * ratio))
  const h = Math.max(1, Math.round(srcCanvas.height * ratio))

  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(srcCanvas, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const len = w * h

  // ── Grayscale (Rec.601) ─────────────────────────────────────────────────
  const gray = new Uint8ClampedArray(len)
  for (let i = 0; i < len; i++) {
    const p = i * 4
    gray[i] = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8
  }

  // Mild blur — kills JPEG/sensor noise without losing real edges
  const blur = boxBlur3(gray, w, h)

  // ── Validation helpers ──────────────────────────────────────────────────
  const validBox = (box) => {
    if (!box) return false
    const dw = box.x2 - box.x
    const dh = box.y2 - box.y
    if (dw < 0.20 || dh < 0.20) return false
    if (dw > 0.95 && dh > 0.95) return false
    const aspect = dw / dh
    return aspect > 0.35 && aspect < 2.85
  }

  const fillScore = (box, mask) => {
    if (!box) return 0
    const x0 = Math.max(0, Math.floor(box.x  * w))
    const y0 = Math.max(0, Math.floor(box.y  * h))
    const x1 = Math.min(w, Math.ceil (box.x2 * w))
    const y1 = Math.min(h, Math.ceil (box.y2 * h))
    let inside = 0, total = 0
    for (let y = y0; y < y1; y++) {
      const off = y * w
      for (let x = x0; x < x1; x++) {
        total++
        if (mask[off + x]) inside++
      }
    }
    return total ? inside / total : 0
  }

  // ── Shared helper: projection profiles → bounding box ──────────────────
  const findBoxFromMask = (mask) => {
    const rowCounts = new Int32Array(h)
    const colCounts = new Int32Array(w)
    for (let y = 0; y < h; y++) {
      const off = y * w
      let rc = 0
      for (let x = 0; x < w; x++) {
        if (mask[off + x]) { rc++; colCounts[x]++ }
      }
      rowCounts[y] = rc
    }
    const rowT = Math.max(4, Math.round(w * 0.12))
    const colT = Math.max(4, Math.round(h * 0.12))
    let top = -1, bot = -1, lft = -1, rgt = -1
    for (let y = 0; y < h; y++) { if (rowCounts[y] >= rowT) { top = y; break } }
    for (let y = h - 1; y >= 0; y--) { if (rowCounts[y] >= rowT) { bot = y; break } }
    for (let x = 0; x < w; x++) { if (colCounts[x] >= colT) { lft = x; break } }
    for (let x = w - 1; x >= 0; x--) { if (colCounts[x] >= colT) { rgt = x; break } }
    if (top < 0 || bot <= top || lft < 0 || rgt <= lft) return null
    const dw = rgt - lft, dh = bot - top
    if (dw < w * 0.20 || dh < h * 0.20) return null
    if (dw > w * 0.95 && dh > h * 0.95) return null
    const px = Math.max(2, Math.round(dw * 0.01))
    const py = Math.max(2, Math.round(dh * 0.01))
    return {
      x:  Math.max(0, (lft - px) / w),
      y:  Math.max(0, (top - py) / h),
      x2: Math.min(1, (rgt + px) / w),
      y2: Math.min(1, (bot + py) / h),
    }
  }

  // Score-and-collect candidates
  const candidates = []

  // ── Strategy 1: Sobel-gradient projection ───────────────────────────────
  // Find edges via gradient magnitude — robust against lighting variance.
  const grad = sobelMagnitude(blur, w, h)
  // 85th-percentile threshold (sample down for speed)
  const sample = []
  const step = Math.max(1, Math.floor(grad.length / 4096))
  for (let i = 0; i < grad.length; i += step) sample.push(grad[i])
  sample.sort((a, b) => a - b)
  const gradT = sample[Math.floor(sample.length * 0.85)] || 30

  // Build edge mask, then close it to consolidate edge fragments
  const gradMask = new Uint8Array(len)
  for (let i = 0; i < len; i++) gradMask[i] = grad[i] >= gradT ? 1 : 0
  const gradMaskClosed = morphClose3(gradMask, w, h)

  // Project edge mask onto rows/cols → outermost significant peaks = bounds
  const rowEdgeCounts = new Int32Array(h)
  const colEdgeCounts = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    const off = y * w
    let rc = 0
    for (let x = 0; x < w; x++) {
      if (gradMaskClosed[off + x]) { rc++; colEdgeCounts[x]++ }
    }
    rowEdgeCounts[y] = rc
  }
  // A row/col is an "edge row" if its edge-count exceeds 35% of its max
  let maxRow = 0, maxCol = 0
  for (let y = 0; y < h; y++) if (rowEdgeCounts[y] > maxRow) maxRow = rowEdgeCounts[y]
  for (let x = 0; x < w; x++) if (colEdgeCounts[x] > maxCol) maxCol = colEdgeCounts[x]
  const rT = Math.max(4, maxRow * 0.35)
  const cT = Math.max(4, maxCol * 0.35)

  let top = -1, bot = -1, lft = -1, rgt = -1
  for (let y = 0; y < h; y++) { if (rowEdgeCounts[y] >= rT) { top = y; break } }
  for (let y = h - 1; y >= 0; y--) { if (rowEdgeCounts[y] >= rT) { bot = y; break } }
  for (let x = 0; x < w; x++) { if (colEdgeCounts[x] >= cT) { lft = x; break } }
  for (let x = w - 1; x >= 0; x--) { if (colEdgeCounts[x] >= cT) { rgt = x; break } }

  if (top >= 0 && bot > top && lft >= 0 && rgt > lft) {
    const px = Math.max(2, Math.round((rgt - lft) * 0.005))
    const py = Math.max(2, Math.round((bot - top) * 0.005))
    const sobBox = {
      x:  Math.max(0, (lft - px) / w),
      y:  Math.max(0, (top - py) / h),
      x2: Math.min(1, (rgt + px) / w),
      y2: Math.min(1, (bot + py) / h),
    }
    if (validBox(sobBox)) {
      candidates.push({ name: 'sobel', box: sobBox, score: fillScore(sobBox, gradMaskClosed) * 1.10 }) // 10% bonus — usually best
    }
  }

  // ── Strategy 2: background-colour sampling (improved with MAD + closing) ─
  const BORD = Math.max(8, Math.round(Math.min(w, h) * 0.05))
  const bgArr = []
  for (let y = 0; y < Math.min(BORD, h); y++)
    for (let x = 0; x < w; x++) bgArr.push(blur[y * w + x])
  for (let y = Math.max(0, h - BORD); y < h; y++)
    for (let x = 0; x < w; x++) bgArr.push(blur[y * w + x])
  for (let y = BORD; y < h - BORD; y++) {
    for (let x = 0; x < Math.min(BORD, w); x++) bgArr.push(blur[y * w + x])
    for (let x = Math.max(0, w - BORD); x < w; x++) bgArr.push(blur[y * w + x])
  }
  bgArr.sort((a, b) => a - b)
  const bgMedian = bgArr[bgArr.length >> 1]
  // Median Absolute Deviation — more robust than std dev to outliers
  const dev = bgArr.map(v => Math.abs(v - bgMedian)).sort((a, b) => a - b)
  const bgMAD = dev[dev.length >> 1] || 4
  const diffT = Math.max(10, bgMAD * 2.5)

  const bgMask = new Uint8Array(len)
  for (let i = 0; i < len; i++) bgMask[i] = Math.abs(blur[i] - bgMedian) > diffT ? 1 : 0
  const bgMaskClosed = morphClose3(bgMask, w, h)

  const bgBox = findBoxFromMask(bgMaskClosed)
  if (validBox(bgBox)) {
    candidates.push({ name: 'bg-sample', box: bgBox, score: fillScore(bgBox, bgMaskClosed) })
  }

  // ── Strategy 3: Otsu on illumination-corrected grayscale ────────────────
  const illum = estimateIllumination(gray, w, h)
  const corr  = correctGray(gray, illum, len, 240)
  const T     = otsuThreshold(corr)

  // Mask = pixels darker than threshold → text/document content vs paper.
  // For document detection on a white surface we instead want pixels that
  // differ from the surface; corr maps paper → ~240, so the document edges
  // and content darken below 240. Using corr[i] < T captures the document body.
  const otsuMask = new Uint8Array(len)
  for (let i = 0; i < len; i++) otsuMask[i] = corr[i] < T ? 1 : 0
  const otsuMaskClosed = morphClose3(otsuMask, w, h)

  const otsuBox = findBoxFromMask(otsuMaskClosed)
  if (validBox(otsuBox)) {
    candidates.push({ name: 'otsu', box: otsuBox, score: fillScore(otsuBox, otsuMaskClosed) * 0.90 })
  }

  // ── Strategy 4: row/column average step-change (fallback) ───────────────
  const rowAvg = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0; const off = y * w
    for (let x = 0; x < w; x++) s += blur[off + x]
    rowAvg[y] = s / w
  }
  const colAvg = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = 0; y < h; y++) s += blur[y * w + x]
    colAvg[x] = s / h
  }

  const rowD = new Float32Array(h)
  const colD = new Float32Array(w)
  let maxRD = 0, maxCD = 0
  for (let y = 1; y < h - 1; y++) { rowD[y] = Math.abs(rowAvg[y+1] - rowAvg[y-1]); if (rowD[y] > maxRD) maxRD = rowD[y] }
  for (let x = 1; x < w - 1; x++) { colD[x] = Math.abs(colAvg[x+1] - colAvg[x-1]); if (colD[x] > maxCD) maxCD = colD[x] }

  if (maxRD > 4 && maxCD > 4) {
    const rDT = maxRD * 0.30
    const cDT = maxCD * 0.30
    let dt = -1, db = -1, dl = -1, dr = -1
    for (let y = 1; y < h - 1; y++) { if (rowD[y] >= rDT) { dt = y; break } }
    for (let y = h - 2; y > 0; y--) { if (rowD[y] >= rDT) { db = y; break } }
    for (let x = 1; x < w - 1; x++) { if (colD[x] >= cDT) { dl = x; break } }
    for (let x = w - 2; x > 0; x--) { if (colD[x] >= cDT) { dr = x; break } }
    if (dt >= 0 && db > dt && dl >= 0 && dr > dl) {
      const derBox = {
        x:  Math.max(0, (dl - 2) / w),
        y:  Math.max(0, (dt - 2) / h),
        x2: Math.min(1, (dr + 2) / w),
        y2: Math.min(1, (db + 2) / h),
      }
      if (validBox(derBox)) {
        // Score against the bg mask (no native mask of its own)
        candidates.push({ name: 'derivative', box: derBox, score: fillScore(derBox, bgMaskClosed) * 0.85 })
      }
    }
  }

  // Pick best candidate by score
  candidates.sort((a, b) => b.score - a.score)
  if (candidates.length > 0) {
    const best = candidates[0]
    console.debug(
      '[Scanner] edge: %s won (score=%.3f). All:',
      best.name, best.score,
      candidates.map(c => `${c.name}=${c.score.toFixed(3)}`).join(', ')
    )
    // ── Refinement: fit lines to the actual document edges around the bbox
    //    and return a true quadrilateral (handles skewed documents).
    const refined = refineCorners(best.box, grad, w, h)
    if (refined) {
      console.debug('[Scanner] edge: refined to quadrilateral')
      return refined
    }
    return best.box
  }

  console.debug('[Scanner] edge: no valid candidate (bgMedian=%d, MAD=%.1f, gradT=%d)', bgMedian, bgMAD, gradT)
  return null
}

/* ── Refine rectangular bbox into a tighter quadrilateral by fitting lines
 *  to the actual document edges. Returns {tl, tr, br, bl} in 0..1 coords,
 *  or null if the refinement is unreliable.
 *
 *  For each side, walk along the long axis and find the pixel-column with
 *  the strongest gradient peak in a narrow strip around the rough edge.
 *  Fit a line through those peaks via weighted least squares (after a
 *  10-90 percentile filter to drop text-induced outliers). The 4 lines'
 *  pairwise intersections are the refined corners.
 *  ────────────────────────────────────────────────────────────────────── */
function refineCorners(box, grad, w, h) {
  const x0 = Math.max(0, Math.floor(box.x * w))
  const y0 = Math.max(0, Math.floor(box.y * h))
  const x1 = Math.min(w - 1, Math.ceil(box.x2 * w))
  const y1 = Math.min(h - 1, Math.ceil(box.y2 * h))
  const bw = x1 - x0
  const bh = y1 - y0
  if (bw < 30 || bh < 30) return null

  // Look ±8% of the bbox dimension perpendicular to each edge
  const marginY = Math.max(6, Math.round(bh * 0.08))
  const marginX = Math.max(6, Math.round(bw * 0.08))

  // Walk along the edge; per column/row find the row/column with max gradient
  // in a narrow strip around the rough edge. Returns [{a, b, w}].
  const peakRow = (xLo, xHi, yCenter) => {
    const pts = []
    const ys0 = Math.max(0, yCenter - marginY)
    const ys1 = Math.min(h - 1, yCenter + marginY)
    for (let x = xLo; x <= xHi; x++) {
      let best = 0, bestY = -1
      for (let y = ys0; y <= ys1; y++) {
        const v = grad[y * w + x]
        if (v > best) { best = v; bestY = y }
      }
      if (bestY >= 0 && best > 40) pts.push({ a: x, b: bestY, wt: best })
    }
    return pts
  }
  const peakCol = (yLo, yHi, xCenter) => {
    const pts = []
    const xs0 = Math.max(0, xCenter - marginX)
    const xs1 = Math.min(w - 1, xCenter + marginX)
    for (let y = yLo; y <= yHi; y++) {
      let best = 0, bestX = -1
      for (let x = xs0; x <= xs1; x++) {
        const v = grad[y * w + x]
        if (v > best) { best = v; bestX = x }
      }
      if (bestX >= 0 && best > 40) pts.push({ a: y, b: bestX, wt: best })
    }
    return pts
  }

  // Weighted least-squares line fit after percentile outlier filter.
  // Returns { slope, intercept } where b = slope*a + intercept, or null.
  const fitLine = (pts) => {
    if (pts.length < 8) return null
    const sorted = [...pts].sort((p, q) => p.b - q.b)
    const lo = sorted[Math.floor(sorted.length * 0.10)].b
    const hi = sorted[Math.floor(sorted.length * 0.90)].b
    const filt = pts.filter(p => p.b >= lo && p.b <= hi)
    if (filt.length < 5) return null
    let SW = 0, SA = 0, SB = 0, SAA = 0, SAB = 0
    for (const p of filt) {
      SW  += p.wt
      SA  += p.wt * p.a
      SB  += p.wt * p.b
      SAA += p.wt * p.a * p.a
      SAB += p.wt * p.a * p.b
    }
    const denom = SW * SAA - SA * SA
    if (Math.abs(denom) < 1e-9) return null
    const slope = (SW * SAB - SA * SB) / denom
    const intercept = (SB - slope * SA) / SW
    return { slope, intercept }
  }

  // Sample edges — slight inset so we don't pick up the exact corner peaks
  const inset = Math.max(2, Math.round(Math.min(bw, bh) * 0.04))
  const topPts = peakRow(x0 + inset, x1 - inset, y0)
  const botPts = peakRow(x0 + inset, x1 - inset, y1)
  const lftPts = peakCol(y0 + inset, y1 - inset, x0)
  const rgtPts = peakCol(y0 + inset, y1 - inset, x1)

  const topL = fitLine(topPts)  // y = mT*x + iT
  const botL = fitLine(botPts)
  const lftL = fitLine(lftPts)  // x = mL*y + iL
  const rgtL = fitLine(rgtPts)

  if (!topL || !botL || !lftL || !rgtL) return null

  // Reject if line slopes imply the edge is wildly off (e.g. >25° tilt)
  const MAX_SLOPE = 0.47   // tan(25°)
  if (Math.abs(topL.slope) > MAX_SLOPE || Math.abs(botL.slope) > MAX_SLOPE) return null
  if (Math.abs(lftL.slope) > MAX_SLOPE || Math.abs(rgtL.slope) > MAX_SLOPE) return null

  // Intersect horizontal-form (y = mh*x + ih) with vertical-form (x = mv*y + iv):
  //   x = mv*(mh*x + ih) + iv = mv*mh*x + mv*ih + iv
  //   x*(1 - mv*mh) = mv*ih + iv
  const intersect = (horz, vert) => {
    const denom = 1 - vert.slope * horz.slope
    if (Math.abs(denom) < 1e-9) return null
    const x = (vert.slope * horz.intercept + vert.intercept) / denom
    const y = horz.slope * x + horz.intercept
    return { x, y }
  }

  const tl = intersect(topL, lftL)
  const tr = intersect(topL, rgtL)
  const br = intersect(botL, rgtL)
  const bl = intersect(botL, lftL)
  if (!tl || !tr || !br || !bl) return null

  // Sanity: each corner must be within the bbox expanded by margin
  const okPx = (p) =>
    p.x >= x0 - marginX && p.x <= x1 + marginX &&
    p.y >= y0 - marginY && p.y <= y1 + marginY
  if (!okPx(tl) || !okPx(tr) || !okPx(br) || !okPx(bl)) return null

  // Normalise to 0..1 and clamp
  const norm = (p) => ({
    x: Math.max(0, Math.min(1, p.x / w)),
    y: Math.max(0, Math.min(1, p.y / h)),
  })
  return { tl: norm(tl), tr: norm(tr), br: norm(br), bl: norm(bl) }
}

// ── Sauvola adaptive binarization ───────────────────────────────────────────
//    T(x,y) = mean(x,y) * (1 + k * ((std(x,y) / R) - 1))
//    — Handles uneven lighting better than Otsu
//    — Uses integral images (mean + squared mean) for O(n) speed
function sauvolaBinarize(gray, w, h, windowSize = 25, k = 0.34, R = 128, offset = 0) {
  const W1 = w + 1
  const iLen = W1 * (h + 1)
  const iSum   = new Float64Array(iLen)
  const iSqSum = new Float64Array(iLen)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = gray[y * w + x]
      const idx = (y + 1) * W1 + (x + 1)
      iSum[idx]   = g       + iSum[y * W1 + (x + 1)]   + iSum[(y + 1) * W1 + x]   - iSum[y * W1 + x]
      iSqSum[idx] = g * g   + iSqSum[y * W1 + (x + 1)] + iSqSum[(y + 1) * W1 + x] - iSqSum[y * W1 + x]
    }
  }

  const half = windowSize >> 1
  const out = new Uint8ClampedArray(w * h)

  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - half)
    const y2 = Math.min(h - 1, y + half)
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - half)
      const x2 = Math.min(w - 1, x + half)

      const count = (x2 - x1 + 1) * (y2 - y1 + 1)
      const sum = iSum[(y2 + 1) * W1 + (x2 + 1)] - iSum[y1 * W1 + (x2 + 1)] - iSum[(y2 + 1) * W1 + x1] + iSum[y1 * W1 + x1]
      const sumSq = iSqSum[(y2 + 1) * W1 + (x2 + 1)] - iSqSum[y1 * W1 + (x2 + 1)] - iSqSum[(y2 + 1) * W1 + x1] + iSqSum[y1 * W1 + x1]

      const mean = sum / count
      const variance = Math.max(0, sumSq / count - mean * mean)
      const std = Math.sqrt(variance)

      const T = mean * (1 + k * (std / R - 1)) + offset
      out[y * w + x] = gray[y * w + x] <= T ? 0 : 255
    }
  }
  return out
}

// ── Simple linear brightness / contrast adjustment ──────────────────────────
function applyBrightnessContrast(data, len, brightness, contrast) {
  // brightness: -100..+100,  contrast: -100..+100
  const b = brightness * 2.55
  // Contrast factor: maps -100..100 → 0..4
  const c = (100 + contrast) / 100
  const cc = c * c
  for (let i = 0; i < len; i++) {
    const p = i * 4
    for (let k = 0; k < 3; k++) {
      let v = data[p + k]
      v = (v - 128) * cc + 128 + b
      data[p + k] = v > 255 ? 255 : v < 0 ? 0 : v
    }
  }
}

// ── Downscale source to working resolution ──────────────────────────────────
function scaleForWork(srcCanvas, maxW) {
  const ratio = srcCanvas.width > maxW ? maxW / srcCanvas.width : 1
  const w = Math.max(1, Math.round(srcCanvas.width  * ratio))
  const h = Math.max(1, Math.round(srcCanvas.height * ratio))
  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const ctx = work.getContext('2d', { willReadFrequently: true })
  // Use high-quality resampling
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(srcCanvas, 0, 0, w, h)
  return work
}

/* ─── Full pipeline ───────────────────────────────────────────────────────── */
function runPipeline(srcCanvas, settings) {
  const { mode, brightness, contrast, thresholdOffset } = settings

  // Photo mode is a pass-through
  if (mode === 'photo') {
    return { canvas: srcCanvas, type: 'image/jpeg', quality: 0.9 }
  }

  // Working resolution — 1800px max = very sharp text, still fast
  const work = scaleForWork(srcCanvas, 1800)
  const ctx = work.getContext('2d', { willReadFrequently: true })
  const imageData = ctx.getImageData(0, 0, work.width, work.height)
  const data = imageData.data
  const w = work.width
  const h = work.height
  const len = w * h

  // Step 1: grayscale (always needed for illumination estimation)
  const gray = toGrayscale(data, len)

  // Step 2: illumination map
  const illum = estimateIllumination(gray, w, h)

  if (mode === 'bw') {
    // Step 3a: flat-field correct the grayscale
    const corrected = correctGray(gray, illum, len, 240)

    // Step 3b: Sauvola binarize the corrected grayscale
    const bw = sauvolaBinarize(corrected, w, h, 25, 0.34, 128, thresholdOffset)

    // Write back as RGBA
    for (let i = 0; i < len; i++) {
      const v = bw[i]
      const p = i * 4
      data[p] = data[p + 1] = data[p + 2] = v
      data[p + 3] = 255
    }

    ctx.putImageData(imageData, 0, 0)
    return { canvas: work, type: 'image/png' }
  }

  if (mode === 'gray') {
    const corrected = correctGray(gray, illum, len, 240)

    // Write back, then apply brightness/contrast
    for (let i = 0; i < len; i++) {
      const v = corrected[i]
      const p = i * 4
      data[p] = data[p + 1] = data[p + 2] = v
      data[p + 3] = 255
    }
    if (brightness !== 0 || contrast !== 0) applyBrightnessContrast(data, len, brightness, contrast)
    ctx.putImageData(imageData, 0, 0)
    return { canvas: work, type: 'image/jpeg', quality: 0.92 }
  }

  // mode === 'color'
  correctColor(data, illum, len, 240)
  if (brightness !== 0 || contrast !== 0) applyBrightnessContrast(data, len, brightness, contrast)
  ctx.putImageData(imageData, 0, 0)
  return { canvas: work, type: 'image/jpeg', quality: 0.92 }
}

// ── Canvas → Blob URL ────────────────────────────────────────────────────────
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('toBlob returned null')),
      type,
      quality
    )
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  PERSPECTIVE WARP
 *  ────────────────
 *  Maps an arbitrary quadrilateral in the source image to a clean rectangle
 *  on the output canvas — the classic "scan a skewed document" transform.
 *
 *  Math:
 *    Compute the 3×3 homography H that maps the unit square [(0,0),(1,0),
 *    (1,1),(0,1)] to source corners (TL, TR, BR, BL). For each output pixel
 *    (u, v) we apply H to (u/W, v/H, 1) → (sx, sy, sw) and sample the source
 *    at (sx/sw, sy/sw) with bilinear interpolation.
 *
 *  Output size:
 *    The output rectangle's width is the average of the top & bottom edge
 *    lengths in source pixels; the height is the average of the left & right
 *    edges. This preserves the "real-world" document aspect as well as we
 *    can without knowing the lens.
 * ═══════════════════════════════════════════════════════════════════════════ */

// Computes the 3x3 homography that maps the unit square to the four points.
// Returns a 9-element row-major matrix.
// Reference: classic "Heckbert" derivation.
function unitToQuadMatrix(p0, p1, p2, p3) {
  // p0=TL→(0,0), p1=TR→(1,0), p2=BR→(1,1), p3=BL→(0,1)
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const sx  = p0.x - p1.x + p2.x - p3.x
  const sy  = p0.y - p1.y + p2.y - p3.y

  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // Affine (parallelogram) — no perspective
    return [
      p1.x - p0.x, p3.x - p0.x, p0.x,
      p1.y - p0.y, p3.y - p0.y, p0.y,
      0,           0,           1,
    ]
  }

  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-12) {
    // Degenerate — bail to affine
    return [
      p1.x - p0.x, p3.x - p0.x, p0.x,
      p1.y - p0.y, p3.y - p0.y, p0.y,
      0,           0,           1,
    ]
  }
  const g = (sx * dy2 - dx2 * sy) / det
  const h = (dx1 * sy - sx * dy1) / det

  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g,                       h,                       1,
  ]
}

// Pixel distance between two corners (normalised in 0..1 vs source dims)
function cornerDistPx(a, b, sw, sh) {
  const dx = (b.x - a.x) * sw
  const dy = (b.y - a.y) * sh
  return Math.sqrt(dx * dx + dy * dy)
}

// Perspective-crop the source canvas using normalised quad corners.
function perspectiveWarp(srcCanvas, corners) {
  const sw = srcCanvas.width
  const sh = srcCanvas.height

  // Output dims: average of opposing edge lengths
  const topLen    = cornerDistPx(corners.tl, corners.tr, sw, sh)
  const botLen    = cornerDistPx(corners.bl, corners.br, sw, sh)
  const leftLen   = cornerDistPx(corners.tl, corners.bl, sw, sh)
  const rightLen  = cornerDistPx(corners.tr, corners.br, sw, sh)
  let outW = Math.max(50, Math.round((topLen + botLen)  / 2))
  let outH = Math.max(50, Math.round((leftLen + rightLen) / 2))

  // Sanity caps — don't let a tiny quad produce a huge upscale
  const MAX_DIM = 3200
  if (outW > MAX_DIM) { outH = Math.round(outH * MAX_DIM / outW); outW = MAX_DIM }
  if (outH > MAX_DIM) { outW = Math.round(outW * MAX_DIM / outH); outH = MAX_DIM }

  // Pull source pixels into a buffer for fast sampling
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  const sImg = sctx.getImageData(0, 0, sw, sh)
  const sData = sImg.data

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d', { willReadFrequently: true })
  const oImg = octx.createImageData(outW, outH)
  const oData = oImg.data

  // Homography maps unit square (0..1, 0..1) to corners (still in 0..1 of src).
  // So the matrix output is in normalised source coords — multiply by (sw, sh)
  // to get pixel coords.
  const H = unitToQuadMatrix(corners.tl, corners.tr, corners.br, corners.bl)
  const m00 = H[0], m01 = H[1], m02 = H[2]
  const m10 = H[3], m11 = H[4], m12 = H[5]
  const m20 = H[6], m21 = H[7], m22 = H[8]

  for (let y = 0; y < outH; y++) {
    const v = y / outH
    for (let x = 0; x < outW; x++) {
      const u = x / outW
      const denom = m20 * u + m21 * v + m22
      if (denom === 0) continue
      const sxN = (m00 * u + m01 * v + m02) / denom
      const syN = (m10 * u + m11 * v + m12) / denom

      const sxP = sxN * sw
      const syP = syN * sh

      // Bilinear sample
      const x0 = Math.floor(sxP)
      const y0 = Math.floor(syP)
      const x1 = x0 + 1
      const y1 = y0 + 1
      if (x0 < 0 || y0 < 0 || x1 >= sw || y1 >= sh) {
        const oi = (y * outW + x) * 4
        oData[oi] = 0; oData[oi + 1] = 0; oData[oi + 2] = 0; oData[oi + 3] = 255
        continue
      }
      const fx = sxP - x0
      const fy = syP - y0
      const w00 = (1 - fx) * (1 - fy)
      const w01 = fx * (1 - fy)
      const w10 = (1 - fx) * fy
      const w11 = fx * fy

      const i00 = (y0 * sw + x0) * 4
      const i01 = (y0 * sw + x1) * 4
      const i10 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4

      const oi = (y * outW + x) * 4
      oData[oi]     = sData[i00]     * w00 + sData[i01]     * w01 + sData[i10]     * w10 + sData[i11]     * w11
      oData[oi + 1] = sData[i00 + 1] * w00 + sData[i01 + 1] * w01 + sData[i10 + 1] * w10 + sData[i11 + 1] * w11
      oData[oi + 2] = sData[i00 + 2] * w00 + sData[i01 + 2] * w01 + sData[i10 + 2] * w10 + sData[i11 + 2] * w11
      oData[oi + 3] = 255
    }
  }

  octx.putImageData(oImg, 0, 0)
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════ */

const MODES = [
  { id: 'bw',    label: 'B&W',   Icon: FileText       },
  { id: 'gray',  label: 'Gray',  Icon: SlidersHorizontal },
  { id: 'color', label: 'Color', Icon: Palette        },
  { id: 'photo', label: 'Photo', Icon: ImageIcon      },
]

export default function InvoiceScanner({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rawCanvasRef = useRef(null)          // offscreen — holds original frame
  const previewUrlRef = useRef(null)
  const previewBlobRef = useRef(null)
  const processDebounceRef = useRef(null)

  const [phase, setPhase] = useState('starting') // starting | live | crop | processing | captured | error
  const [previewUrl, setPreviewUrl] = useState(null)
  const [rawPreviewUrl, setRawPreviewUrl] = useState(null) // used by CropOverlay
  const [errorMsg, setErrorMsg] = useState('')

  // Settings
  const [mode, setMode] = useState('bw')
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(0)
  const [thresholdOffset, setThresholdOffset] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Replace preview URL and clean up the old one
  const setPreview = useCallback((url, blob) => {
    if (previewUrlRef.current && previewUrlRef.current !== url) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    previewUrlRef.current = url
    previewBlobRef.current = blob
    setPreviewUrl(url)
  }, [])

  // ─── Camera ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setPhase('starting')
    setErrorMsg('')
    setPreview(null, null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 2560 },
          height: { ideal: 1440 },
        },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
        if (!video.videoWidth) {
          await new Promise((r) => {
            const handler = () => { video.removeEventListener('loadedmetadata', handler); r() }
            video.addEventListener('loadedmetadata', handler)
          })
        }
      }
      setPhase('live')
    } catch (err) {
      console.error('[Scanner] camera error:', err)
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access and try again.'
          : 'Could not open camera. Try uploading a file instead.'
      )
      setPhase('error')
    }
  }, [setPreview])

  useEffect(() => {
    startCamera()
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      clearTimeout(processDebounceRef.current)
    }
  }, [startCamera])

  // ─── Process current raw canvas with current settings ──────────────────────
  const processAndShow = useCallback(async () => {
    const raw = rawCanvasRef.current
    if (!raw) return
    setPhase('processing')
    // Yield to paint the spinner
    await new Promise((r) => setTimeout(r, 30))
    try {
      const t0 = performance.now()
      const { canvas, type, quality } = runPipeline(raw, {
        mode, brightness, contrast, thresholdOffset,
      })
      const blob = await canvasToBlob(canvas, type, quality)
      const url = URL.createObjectURL(blob)
      setPreview(url, blob)
      setPhase('captured')
      console.log(`[Scanner] ${mode} pipeline: ${Math.round(performance.now() - t0)}ms, ${(blob.size / 1024).toFixed(0)}KB`)
    } catch (err) {
      console.error('[Scanner] processing error:', err)
      setErrorMsg(`Processing failed: ${err.message}`)
      setPhase('error')
    }
  }, [mode, brightness, contrast, thresholdOffset, setPreview])

  // ─── Capture ────────────────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) {
      setErrorMsg('Camera is still loading — try again in a second.')
      setPhase('error')
      return
    }

    // Draw into an offscreen raw canvas FIRST, before touching the stream
    let raw = rawCanvasRef.current
    if (!raw) {
      raw = document.createElement('canvas')
      rawCanvasRef.current = raw
    }
    raw.width = vw
    raw.height = vh
    const ctx = raw.getContext('2d')
    ctx.drawImage(video, 0, 0, vw, vh)

    streamRef.current?.getTracks().forEach((t) => t.stop())

    // Show crop UI first — blob URL of the raw frame as background image
    raw.toBlob((blob) => {
      if (!blob) { processAndShow(); return }
      const url = URL.createObjectURL(blob)
      setRawPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
      setPhase('crop')
    }, 'image/jpeg', 0.85)
  }, [processAndShow])

  // ─── Re-process when settings change after capture (debounced) ─────────────
  useEffect(() => {
    if (phase !== 'captured') return
    clearTimeout(processDebounceRef.current)
    processDebounceRef.current = setTimeout(() => { processAndShow() }, 150)
    return () => clearTimeout(processDebounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, brightness, contrast, thresholdOffset])

  // ─── Crop callbacks ─────────────────────────────────────────────────────────
  // Accepts either a rectangle {x,y,x2,y2} or a quadrilateral {tl,tr,br,bl}.
  // Rectangles are handled with a plain crop; quads go through perspective warp.
  const handleCropApply = useCallback((shape) => {
    const raw = rawCanvasRef.current
    if (!raw) { processAndShow(); return }

    try {
      let cropped
      if (shape.tl && shape.tr && shape.br && shape.bl) {
        // Quadrilateral — perspective-warp into a clean rectangle
        cropped = perspectiveWarp(raw, shape)
      } else {
        const px = Math.round(shape.x  * raw.width)
        const py = Math.round(shape.y  * raw.height)
        const pw = Math.round((shape.x2 - shape.x) * raw.width)
        const ph = Math.round((shape.y2 - shape.y) * raw.height)
        if (pw < 10 || ph < 10) { processAndShow(); return }
        cropped = document.createElement('canvas')
        cropped.width  = pw
        cropped.height = ph
        cropped.getContext('2d').drawImage(raw, px, py, pw, ph, 0, 0, pw, ph)
      }
      if (cropped.width < 10 || cropped.height < 10) { processAndShow(); return }
      rawCanvasRef.current = cropped
    } catch (err) {
      console.warn('[Scanner] crop failed, falling back to skip:', err)
    }

    setRawPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    processAndShow()
  }, [processAndShow])

  const handleCropSkip = useCallback(() => {
    setRawPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    processAndShow()
  }, [processAndShow])

  // ─── Auto-detect document edges in the raw frame ───────────────────────────
  const handleDetect = useCallback(() => {
    const raw = rawCanvasRef.current
    if (!raw) return null
    try {
      return detectDocument(raw)
    } catch (err) {
      console.warn('[Scanner] detection failed:', err)
      return null
    }
  }, [])

  // ─── Rotate rawCanvas 90° (called from crop overlay) ───────────────────────
  const handleRotate = useCallback((degrees) => {
    const raw = rawCanvasRef.current
    if (!raw) return

    const rad = (degrees * Math.PI) / 180
    const rotated = document.createElement('canvas')

    // For 90° increments, dimensions swap; for 180° they stay the same
    const mod = ((degrees % 360) + 360) % 360
    if (mod === 90 || mod === 270) {
      rotated.width  = raw.height
      rotated.height = raw.width
    } else {
      rotated.width  = raw.width
      rotated.height = raw.height
    }

    const ctx = rotated.getContext('2d')
    ctx.translate(rotated.width / 2, rotated.height / 2)
    ctx.rotate(rad)
    ctx.drawImage(raw, -raw.width / 2, -raw.height / 2)

    rawCanvasRef.current = rotated

    rotated.toBlob(
      (blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        setRawPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
      },
      'image/jpeg',
      0.85,
    )
  }, [])

  const retake = () => {
    rawCanvasRef.current = null
    setPreview(null, null)
    setRawPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setBrightness(0)
    setContrast(0)
    setThresholdOffset(0)
    startCamera()
  }

  // ─── Build PDF ──────────────────────────────────────────────────────────────
  const useScan = async () => {
    if (!previewBlobRef.current) return
    setPhase('processing')
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new window.Image()
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error('Could not load captured image'))
        i.src = previewUrlRef.current
      })

      const isPortrait = img.naturalHeight >= img.naturalWidth
      const pdf = new jsPDF({ orientation: isPortrait ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pageW / img.naturalWidth, pageH / img.naturalHeight)
      const dw = img.naturalWidth * ratio
      const dh = img.naturalHeight * ratio

      // jsPDF wants a data URL — convert from blob once, here
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(previewBlobRef.current)
      })
      const fmt = mode === 'bw' ? 'PNG' : 'JPEG'
      pdf.addImage(dataUrl, fmt, (pageW - dw) / 2, (pageH - dh) / 2, dw, dh)

      const pdfBlob = pdf.output('blob')
      const file = new File([pdfBlob], `invoice_scan_${Date.now()}.pdf`, { type: 'application/pdf' })
      onCapture(file)
      onClose()
    } catch (err) {
      console.error('[Scanner] PDF error:', err)
      setErrorMsg(`Failed to generate PDF: ${err.message}`)
      setPhase('captured')
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  const activeMode = MODES.find((m) => m.id === mode) || MODES[0]

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/85 shrink-0 border-b border-white/5">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-blue-400" />
          <span className="text-sm font-semibold text-gray-100">
            {phase === 'captured' ? 'Review Scan' : phase === 'crop' ? 'Crop' : 'Scan Invoice'}
          </span>
          {phase === 'captured' && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
              {activeMode.label}
            </span>
          )}
        </div>
        <button
          onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); onClose() }}
          className="p-2 text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Viewport */}
      <div className="flex-1 relative overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            phase === 'live' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {phase === 'live' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[88%] max-w-xs aspect-[8.5/11] relative">
              {['top-0 left-0 border-t-2 border-l-2',
                'top-0 right-0 border-t-2 border-r-2',
                'bottom-0 left-0 border-b-2 border-l-2',
                'bottom-0 right-0 border-b-2 border-r-2']
                .map((cls, i) => (
                  <div key={i} className={`absolute w-7 h-7 border-blue-400 rounded-sm ${cls}`} />
                ))}
              <motion.div
                animate={{ top: ['5%', '92%', '5%'] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-0 right-0 h-px bg-blue-400/80"
                style={{ boxShadow: '0 0 10px 3px rgba(96,165,250,0.5)' }}
              />
            </div>
            <p className="absolute bottom-36 text-[11px] text-gray-500 text-center px-8 tracking-wide">
              Align invoice — hold steady, bright even light
            </p>
          </div>
        )}

        {/* Crop overlay */}
        {phase === 'crop' && rawPreviewUrl && (
          <CropOverlay
            imageUrl={rawPreviewUrl}
            onApply={handleCropApply}
            onSkip={handleCropSkip}
            onRotate={handleRotate}
            onDetect={handleDetect}
          />
        )}

        {phase === 'captured' && previewUrl && (
          <img
            key={previewUrl}
            src={previewUrl}
            alt="Scanned"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ background: mode === 'bw' ? '#fff' : mode === 'gray' ? '#fafafa' : '#000' }}
            onError={() => {
              setErrorMsg('Preview failed to render.')
              setPhase('error')
            }}
          />
        )}

        {(phase === 'starting' || phase === 'processing') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
            <Loader2 size={32} className="animate-spin text-blue-400" />
            <p className="text-sm text-gray-300">
              {phase === 'starting' ? 'Starting camera…' : 'Processing scan…'}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8">
            <ZapOff size={36} className="text-red-400" />
            <p className="text-sm text-gray-300 text-center">{errorMsg}</p>
            <button onClick={startCamera} className="px-5 py-2.5 bg-gray-700 rounded-xl text-sm font-semibold text-white">
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Controls — hidden during crop (crop overlay has its own buttons) */}
      {phase !== 'crop' && (
      <div className="shrink-0 bg-black/90 px-4 pb-8 pt-3 border-t border-white/5">

        {phase === 'live' && (
          <div className="flex items-center justify-between px-2">
            <div className="w-12" />

            <button
              onClick={capture}
              className="rounded-full bg-white active:scale-95 transition-transform shadow-[0_0_24px_rgba(255,255,255,0.25)] flex items-center justify-center"
              style={{ width: 76, height: 76 }}
            >
              <div className="rounded-full bg-white border-[5px] border-gray-300" style={{ width: 62, height: 62 }} />
            </button>

            <div className="w-12 text-right">
              <button
                onClick={() => setMode(mode === 'bw' ? 'color' : mode === 'color' ? 'gray' : mode === 'gray' ? 'photo' : 'bw')}
                className="text-[10px] text-gray-400 font-medium px-2 py-1 rounded bg-gray-800 border border-gray-700"
              >
                {activeMode.label}
              </button>
            </div>
          </div>
        )}

        {phase === 'captured' && (
          <>
            {/* Mode tabs */}
            <div className="flex gap-1.5 mb-3 p-1 bg-gray-900/60 rounded-xl border border-white/5">
              {MODES.map((m) => {
                const Icon = m.Icon
                const active = mode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Icon size={13} />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {/* Adjustments */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2 font-medium"
            >
              <SlidersHorizontal size={12} />
              {showAdvanced ? 'Hide' : 'Adjust'}
            </button>

            {showAdvanced && (
              <div className="space-y-2.5 mb-3 bg-gray-900/40 rounded-xl p-3 border border-white/5">
                {mode === 'bw' && (
                  <Slider
                    label="Threshold"
                    value={thresholdOffset}
                    setValue={setThresholdOffset}
                    min={-40}
                    max={40}
                    hint={thresholdOffset > 0 ? 'darker' : thresholdOffset < 0 ? 'lighter' : '—'}
                  />
                )}
                {(mode === 'gray' || mode === 'color') && (
                  <>
                    <Slider label="Brightness" value={brightness} setValue={setBrightness} min={-60} max={60} />
                    <Slider label="Contrast" value={contrast} setValue={setContrast} min={-60} max={60} />
                  </>
                )}
                {mode === 'photo' && (
                  <p className="text-[11px] text-gray-600 italic text-center py-1">
                    Photo mode — no processing applied
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={retake}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm font-semibold text-gray-200 active:scale-95 transition-transform"
              >
                <RotateCcw size={15} />
                Retake
              </button>
              <button
                onClick={useScan}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white active:scale-95 transition-transform"
              >
                <CheckCircle size={15} />
                Use This
              </button>
            </div>
          </>
        )}

        {phase === 'processing' && (
          <div className="flex justify-center py-3">
            <Loader2 size={22} className="animate-spin text-blue-400" />
          </div>
        )}
      </div>
      )}
    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────────────────────
function Slider({ label, value, setValue, min, max, hint }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
          {label}
        </label>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {value > 0 ? `+${value}` : value}
          {hint ? ` · ${hint}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  )
}
