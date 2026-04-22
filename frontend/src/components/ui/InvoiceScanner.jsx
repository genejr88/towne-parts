import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import { jsPDF } from 'jspdf'
import {
  RotateCcw, RotateCw, Maximize2, Sparkles, CheckCircle, X, Loader2, ScanLine, ZapOff,
  FileText, Image as ImageIcon, Palette, SlidersHorizontal, Crop
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
 *  CROP OVERLAY
 *  ─────────────
 *  High-performance crop UI:
 *    • Box stored in a ref (NOT React state) — no re-renders during drag
 *    • DOM styles written directly via selectionRef on each move
 *    • requestAnimationFrame batches updates to one per frame
 *    • Pointer capture on the image-area wrapper so drags never get "lost"
 *      when the pointer slips outside a handle
 *    • Crop area is sized to the image's actual rendered region (not the
 *      whole container) — correct behaviour when the image is letter-boxed
 *      inside a non-matching aspect-ratio viewport
 *    • 4 corner + 4 edge handles for precise adjustment
 *    • Rotate L / R and Reset buttons wired to parent
 * ═══════════════════════════════════════════════════════════════════════════ */

function CropOverlay({ imageUrl, onApply, onSkip, onRotate, onDetect }) {
  const wrapRef = useRef(null)          // fills viewport, measures for letterbox math
  const imageAreaRef = useRef(null)     // sized to image's rendered area; receives pointer capture
  const selectionRef = useRef(null)     // crop rectangle DOM node
  const imgRef = useRef(null)
  const boxRef = useRef({ x: 0.04, y: 0.04, x2: 0.96, y2: 0.96 })
  const dragStateRef = useRef(null)     // { handle, start, startBox }
  const rafRef = useRef(null)

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 })

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  const MIN = 0.05

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

  // ── Direct-to-DOM box writer (no React involvement) ───────────────────────
  const applyBoxToDOM = () => {
    const el = selectionRef.current
    if (!el) return
    const b = boxRef.current
    el.style.left   = (b.x  * 100) + '%'
    el.style.top    = (b.y  * 100) + '%'
    el.style.width  = ((b.x2 - b.x) * 100) + '%'
    el.style.height = ((b.y2 - b.y) * 100) + '%'
  }

  const scheduleUpdate = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      applyBoxToDOM()
    })
  }

  // Re-apply after every render (cheap; only sets 4 inline styles)
  useLayoutEffect(() => { applyBoxToDOM() })

  // Measure wrap container & observe resize (orientation changes, etc.)
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

  // Animate selection to a new box (used by auto-detect)
  const animateToBox = (target) => {
    const el = selectionRef.current
    boxRef.current = target
    if (!el) { applyBoxToDOM(); return }
    el.style.transition = 'left 220ms ease-out, top 220ms ease-out, width 220ms ease-out, height 220ms ease-out'
    applyBoxToDOM()
    window.setTimeout(() => { if (el) el.style.transition = '' }, 240)
  }

  const runAutoDetect = () => {
    if (!onDetect) return false
    const detected = onDetect()
    if (!detected) return false
    animateToBox(detected)
    return true
  }

  const onImgLoad = () => {
    const img = imgRef.current
    if (!img) return
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight })

    // Try automatic detection first — fall back to default box if nothing found
    const detected = onDetect ? onDetect() : null
    if (detected) {
      boxRef.current = detected
    } else {
      boxRef.current = { x: 0.04, y: 0.04, x2: 0.96, y2: 0.96 }
    }
    applyBoxToDOM()
  }

  // ── Pointer helpers — always relative to imageAreaRef (the real image box) ─
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
      startBox: { ...boxRef.current },
      pointerId: e.pointerId,
    }
    try { imageAreaRef.current?.setPointerCapture(e.pointerId) } catch {}
  }

  const onPointerMove = (e) => {
    const d = dragStateRef.current
    if (!d) return
    e.preventDefault()
    const pos = getRel(e)
    const dx = pos.x - d.start.x
    const dy = pos.y - d.start.y
    const sb = d.startBox
    const b  = boxRef.current

    switch (d.handle) {
      case 'tl':
        b.x  = clamp(sb.x  + dx, 0, sb.x2 - MIN)
        b.y  = clamp(sb.y  + dy, 0, sb.y2 - MIN)
        b.x2 = sb.x2; b.y2 = sb.y2; break
      case 'tr':
        b.x2 = clamp(sb.x2 + dx, sb.x + MIN, 1)
        b.y  = clamp(sb.y  + dy, 0, sb.y2 - MIN)
        b.x  = sb.x;  b.y2 = sb.y2; break
      case 'bl':
        b.x  = clamp(sb.x  + dx, 0, sb.x2 - MIN)
        b.y2 = clamp(sb.y2 + dy, sb.y + MIN, 1)
        b.x2 = sb.x2; b.y  = sb.y; break
      case 'br':
        b.x2 = clamp(sb.x2 + dx, sb.x + MIN, 1)
        b.y2 = clamp(sb.y2 + dy, sb.y + MIN, 1)
        b.x  = sb.x;  b.y  = sb.y; break
      case 't':
        b.y  = clamp(sb.y  + dy, 0, sb.y2 - MIN)
        b.x  = sb.x; b.x2 = sb.x2; b.y2 = sb.y2; break
      case 'r':
        b.x2 = clamp(sb.x2 + dx, sb.x + MIN, 1)
        b.x  = sb.x; b.y = sb.y; b.y2 = sb.y2; break
      case 'bt':
        b.y2 = clamp(sb.y2 + dy, sb.y + MIN, 1)
        b.x  = sb.x; b.x2 = sb.x2; b.y = sb.y; break
      case 'l':
        b.x  = clamp(sb.x  + dx, 0, sb.x2 - MIN)
        b.x2 = sb.x2; b.y = sb.y; b.y2 = sb.y2; break
      case 'body': {
        const w = sb.x2 - sb.x
        const h = sb.y2 - sb.y
        const nx = clamp(sb.x + dx, 0, 1 - w)
        const ny = clamp(sb.y + dy, 0, 1 - h)
        b.x = nx; b.y = ny; b.x2 = nx + w; b.y2 = ny + h
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
    boxRef.current = { x: 0.04, y: 0.04, x2: 0.96, y2: 0.96 }
    applyBoxToDOM()
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={wrapRef} className="flex-1 relative overflow-hidden bg-black select-none">
        {/* The image itself — draws the full letter-boxed view */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          onLoad={onImgLoad}
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />

        {/* Interaction layer: sized exactly to the visible image rect */}
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
          {/* Selection rectangle */}
          <div
            ref={selectionRef}
            className="absolute border border-white/95 cursor-move"
            style={{
              boxShadow: '0 0 0 4000px rgba(0,0,0,0.6)',
              willChange: 'left, top, width, height',
            }}
            onPointerDown={onPointerDown('body')}
          >
            {/* Rule-of-thirds grid */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="border border-white/15" />
              ))}
            </div>

            {/* Corner handles */}
            <CornerHandle pos="tl" onPointerDown={onPointerDown('tl')} />
            <CornerHandle pos="tr" onPointerDown={onPointerDown('tr')} />
            <CornerHandle pos="bl" onPointerDown={onPointerDown('bl')} />
            <CornerHandle pos="br" onPointerDown={onPointerDown('br')} />

            {/* Edge handles */}
            <EdgeHandle pos="t"  onPointerDown={onPointerDown('t')} />
            <EdgeHandle pos="r"  onPointerDown={onPointerDown('r')} />
            <EdgeHandle pos="bt" onPointerDown={onPointerDown('bt')} />
            <EdgeHandle pos="l"  onPointerDown={onPointerDown('l')} />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="shrink-0 bg-black/90 px-4 pb-8 pt-3 border-t border-white/5">
        {/* Rotate / Auto / Reset row */}
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
            onClick={() => onApply({ ...boxRef.current })}
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

// Corner handle: transparent 40×40 touch target with white L-shape inside
function CornerHandle({ pos, onPointerDown }) {
  const posClass = {
    tl: '-top-5 -left-5  cursor-nwse-resize',
    tr: '-top-5 -right-5 cursor-nesw-resize',
    bl: '-bottom-5 -left-5  cursor-nesw-resize',
    br: '-bottom-5 -right-5 cursor-nwse-resize',
  }[pos]
  const corner = {
    tl: { top: 10, left: 10, borderTop: '3px solid white', borderLeft: '3px solid white', borderTopLeftRadius: 4 },
    tr: { top: 10, right: 10, borderTop: '3px solid white', borderRight: '3px solid white', borderTopRightRadius: 4 },
    bl: { bottom: 10, left: 10, borderBottom: '3px solid white', borderLeft: '3px solid white', borderBottomLeftRadius: 4 },
    br: { bottom: 10, right: 10, borderBottom: '3px solid white', borderRight: '3px solid white', borderBottomRightRadius: 4 },
  }[pos]
  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute ${posClass} z-10`}
      style={{ width: 40, height: 40, touchAction: 'none' }}
    >
      <div className="absolute" style={{ width: 18, height: 18, ...corner }} />
    </div>
  )
}

// Edge handle: transparent touch target with small white bar centered
function EdgeHandle({ pos, onPointerDown }) {
  const wrap = {
    t:  'left-1/2 -top-5    -translate-x-1/2 cursor-ns-resize',
    bt: 'left-1/2 -bottom-5 -translate-x-1/2 cursor-ns-resize',
    l:  'top-1/2 -left-5    -translate-y-1/2 cursor-ew-resize',
    r:  'top-1/2 -right-5   -translate-y-1/2 cursor-ew-resize',
  }[pos]
  const horizontal = pos === 't' || pos === 'bt'
  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute ${wrap} z-10 flex items-center justify-center`}
      style={{
        width:  horizontal ? 56 : 40,
        height: horizontal ? 40 : 56,
        touchAction: 'none',
      }}
    >
      <div
        className="bg-white rounded-full"
        style={{
          width:  horizontal ? 24 : 3,
          height: horizontal ? 3  : 24,
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
 *  Heuristic designed for the "paper on a darker surface" case:
 *    1.  Downscale to ~400px for speed (detection runs in <50 ms)
 *    2.  Convert to grayscale
 *    3.  Apply flat-field correction so shadows don't bias the threshold
 *    4.  Otsu-threshold to isolate bright pixels (= paper)
 *    5.  Build row & column projection profiles of paper-pixel counts
 *    6.  The first/last rows & cols where the profile exceeds a fraction of
 *        the image dimension mark the document edges
 *    7.  Sanity-check that the detection covers ≥ 25 % of the frame — else
 *        return null so the caller falls back to the default box
 *
 *  Returns a normalised box {x,y,x2,y2} in 0-1 coords, or null if nothing
 *  confidently found.
 * ────────────────────────────────────────────────────────────────────────── */
function detectDocument(srcCanvas) {
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return null

  const MAX_W = 400
  const ratio = Math.min(1, MAX_W / srcCanvas.width)
  const w = Math.max(1, Math.round(srcCanvas.width  * ratio))
  const h = Math.max(1, Math.round(srcCanvas.height * ratio))

  const c = document.createElement('canvas')
  c.width  = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(srcCanvas, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const len = w * h

  // Grayscale
  const gray = new Uint8ClampedArray(len)
  for (let i = 0; i < len; i++) {
    const p = i * 4
    gray[i] = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8
  }

  // Flat-field correct so shadows don't throw off Otsu
  const illum = estimateIllumination(gray, w, h)
  const corrected = correctGray(gray, illum, len, 240)

  // Otsu to separate "paper" (bright) from "background"
  const T = otsuThreshold(corrected)

  // Projection profiles — count bright pixels per row / per column
  const rowCounts = new Int32Array(h)
  const colCounts = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    const off = y * w
    let rc = 0
    for (let x = 0; x < w; x++) {
      if (corrected[off + x] > T) {
        rc++
        colCounts[x]++
      }
    }
    rowCounts[y] = rc
  }

  // A row "has document" if > 25 % of its pixels are bright; same for cols
  const rowThresh = Math.max(8, Math.round(w * 0.25))
  const colThresh = Math.max(8, Math.round(h * 0.25))

  let top = -1, bottom = -1, left = -1, right = -1
  for (let y = 0; y < h; y++) { if (rowCounts[y] >= rowThresh) { top = y; break } }
  for (let y = h - 1; y >= 0; y--) { if (rowCounts[y] >= rowThresh) { bottom = y; break } }
  for (let x = 0; x < w; x++) { if (colCounts[x] >= colThresh) { left = x; break } }
  for (let x = w - 1; x >= 0; x--) { if (colCounts[x] >= colThresh) { right = x; break } }

  if (top < 0 || bottom <= top || left < 0 || right <= left) return null

  // Reject if the detection is tiny (< 25 % either axis) — probably noise
  if ((right - left) < w * 0.25 || (bottom - top) < h * 0.25) return null

  // Grow outward a hair so we don't clip the very edge of the paper
  const padX = Math.max(1, Math.round(w * 0.006))
  const padY = Math.max(1, Math.round(h * 0.006))

  return {
    x:  Math.max(0, (left   - padX) / w),
    y:  Math.max(0, (top    - padY) / h),
    x2: Math.min(1, (right  + padX) / w),
    y2: Math.min(1, (bottom + padY) / h),
  }
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
  const handleCropApply = useCallback((box) => {
    const raw = rawCanvasRef.current
    if (!raw) { processAndShow(); return }

    // Compute pixel coords from normalised box
    // The image is displayed with object-contain so the actual visible area
    // may be letter-boxed. We stored the raw canvas at real pixel size so
    // we just map 0-1 directly onto that.
    const px = Math.round(box.x  * raw.width)
    const py = Math.round(box.y  * raw.height)
    const pw = Math.round((box.x2 - box.x) * raw.width)
    const ph = Math.round((box.y2 - box.y) * raw.height)

    if (pw < 10 || ph < 10) { processAndShow(); return }

    const cropped = document.createElement('canvas')
    cropped.width  = pw
    cropped.height = ph
    const ctx = cropped.getContext('2d')
    ctx.drawImage(raw, px, py, pw, ph, 0, 0, pw, ph)
    rawCanvasRef.current = cropped

    // Clean up raw preview URL — no longer needed
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
