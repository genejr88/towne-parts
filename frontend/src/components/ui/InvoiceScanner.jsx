import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { jsPDF } from 'jspdf'
import { RotateCcw, CheckCircle, X, Loader2, ScanLine, ZapOff, FileText, Image } from 'lucide-react'

// ── Image processing ─────────────────────────────────────────────────────────

/** Convert RGBA pixel data to a grayscale Uint8Array */
function toGrayscale(data, len) {
  const gray = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    const p = i * 4
    gray[i] = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8
  }
  return gray
}

/**
 * Otsu's method — finds the threshold value that best separates dark (text)
 * from light (paper) pixels. Works automatically regardless of exposure.
 */
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
    const variance = w0 * w1 * (u0 - u1) ** 2
    if (variance > maxVar) { maxVar = variance; bestT = t }
  }
  return bestT
}

/**
 * Full document scan pipeline:
 *   1. Grayscale
 *   2. Auto-threshold via Otsu (text → 0, paper → 255)
 * Returns a new ImageData with pure B&W pixels.
 */
function processDocumentScan(srcCanvas) {
  // Work canvas — scale to max 1400px wide for performance
  const maxW = 1400
  const scale = srcCanvas.width > maxW ? maxW / srcCanvas.width : 1
  const w = Math.round(srcCanvas.width * scale)
  const h = Math.round(srcCanvas.height * scale)

  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const ctx = work.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(srcCanvas, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data
  const len = w * h

  const gray = toGrayscale(data, len)
  const T = otsuThreshold(gray)

  // Apply threshold — text goes black, paper goes white
  for (let i = 0; i < len; i++) {
    const val = gray[i] <= T ? 0 : 255
    const p = i * 4
    data[p] = data[p + 1] = data[p + 2] = val
    data[p + 3] = 255
  }

  ctx.putImageData(imageData, 0, 0)
  return work
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceScanner({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [phase, setPhase] = useState('starting') // starting | live | processing | captured | error
  const [capturedDataUrl, setCapturedDataUrl] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [mode, setMode] = useState('document') // 'document' | 'photo'

  // ── Camera ──────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setPhase('starting')
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPhase('live')
    } catch (err) {
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access and try again.'
          : 'Could not open camera. Try uploading a file instead.'
      )
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [startCamera])

  // ── Capture ──────────────────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    streamRef.current?.getTracks().forEach((t) => t.stop())
    setPhase('processing')

    // Delay slightly so the "Processing…" spinner actually renders
    setTimeout(() => {
      try {
        // Draw the video frame to the hidden canvas
        canvas.width = video.videoWidth || 1280
        canvas.height = video.videoHeight || 720
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)

        let dataUrl

        if (mode === 'document') {
          // Run through the B&W scan pipeline
          const processed = processDocumentScan(canvas)
          // PNG = lossless — no JPEG smearing of B&W pixels back to gray
          dataUrl = processed.toDataURL('image/png')
        } else {
          // Color photo — just a high quality JPEG
          dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        }

        setCapturedDataUrl(dataUrl)
        setPhase('captured')
      } catch (err) {
        console.error('[Scanner] processing error:', err)
        setErrorMsg(`Processing failed: ${err.message}`)
        setPhase('error')
      }
    }, 120)
  }, [mode])

  const retake = () => {
    setCapturedDataUrl(null)
    startCamera()
  }

  // ── Generate PDF and upload ──────────────────────────────────────────────────
  const useScan = async () => {
    setPhase('processing')
    try {
      const img = new Image()
      img.src = capturedDataUrl
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej })

      const isPortrait = img.naturalHeight >= img.naturalWidth
      const pdf = new jsPDF({ orientation: isPortrait ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pageW / img.naturalWidth, pageH / img.naturalHeight)

      // PNG for document scans, JPEG for photos
      const fmt = mode === 'document' ? 'PNG' : 'JPEG'
      pdf.addImage(capturedDataUrl, fmt, (pageW - img.naturalWidth * ratio) / 2, (pageH - img.naturalHeight * ratio) / 2, img.naturalWidth * ratio, img.naturalHeight * ratio)

      const blob = pdf.output('blob')
      const file = new File([blob], `invoice_scan_${Date.now()}.pdf`, { type: 'application/pdf' })
      onCapture(file)
      onClose()
    } catch (err) {
      console.error('[Scanner] PDF error:', err)
      setErrorMsg('Failed to generate PDF. Please try again.')
      setPhase('captured')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <canvas ref={canvasRef} className="hidden" />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 shrink-0">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-blue-400" />
          <span className="text-sm font-semibold text-gray-100">
            {phase === 'captured' ? 'Review Scan' : 'Scan Invoice'}
          </span>
          {phase === 'captured' && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              mode === 'document' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {mode === 'document' ? 'B&W Document' : 'Color Photo'}
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

      {/* Viewfinder / Preview */}
      <div className="flex-1 relative overflow-hidden bg-black">

        {/* Live camera feed */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            phase === 'live' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* Framing guides */}
        {phase === 'live' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[88%] max-w-xs aspect-[8.5/11] relative">
              {['top-0 left-0 border-t-2 border-l-2', 'top-0 right-0 border-t-2 border-r-2',
                'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2']
                .map((cls, i) => (
                  <div key={i} className={`absolute w-7 h-7 border-blue-400 rounded-sm ${cls}`} />
                ))}
              <motion.div
                animate={{ top: ['5%', '92%', '5%'] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-0 right-0 h-px bg-blue-400/70"
                style={{ boxShadow: '0 0 10px 3px rgba(96,165,250,0.35)' }}
              />
            </div>
            <p className="absolute bottom-28 text-xs text-gray-500 text-center px-8">
              Align invoice within the frame
            </p>
          </div>
        )}

        {/* Scanned result preview — B&W should be very obvious */}
        {phase === 'captured' && capturedDataUrl && (
          <img
            src={capturedDataUrl}
            alt="Scanned"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ background: mode === 'document' ? '#fff' : '#000' }}
          />
        )}

        {/* Spinners */}
        {(phase === 'starting' || phase === 'processing') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-blue-400" />
            <p className="text-sm text-gray-400">
              {phase === 'starting' ? 'Starting camera…' : 'Processing scan…'}
            </p>
          </div>
        )}

        {/* Error */}
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

      {/* Bottom controls */}
      <div className="shrink-0 bg-black/90 px-6 pb-10 pt-4">

        {phase === 'live' && (
          <div className="flex items-center justify-between">
            {/* Doc / Photo toggle */}
            <button
              onClick={() => setMode(m => m === 'document' ? 'photo' : 'document')}
              className="flex flex-col items-center gap-1"
            >
              <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-colors ${
                mode === 'document' ? 'border-blue-400 bg-blue-400/10' : 'border-gray-600 bg-gray-800'
              }`}>
                {mode === 'document'
                  ? <FileText size={16} className="text-blue-400" />
                  : <Image size={16} className="text-gray-400" />}
              </div>
              <span className={`text-[10px] font-medium ${mode === 'document' ? 'text-blue-400' : 'text-gray-500'}`}>
                {mode === 'document' ? 'Doc' : 'Photo'}
              </span>
            </button>

            {/* Shutter */}
            <button
              onClick={capture}
              className="rounded-full bg-white active:scale-95 transition-transform shadow-lg flex items-center justify-center"
              style={{ width: 72, height: 72 }}
            >
              <div className="rounded-full bg-white border-[5px] border-gray-300" style={{ width: 60, height: 60 }} />
            </button>

            <div className="w-11" />
          </div>
        )}

        {phase === 'captured' && (
          <div className="flex items-center gap-3">
            <button
              onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gray-800 border border-gray-700 text-sm font-semibold text-gray-200 active:scale-95 transition-transform"
            >
              <RotateCcw size={16} />
              Retake
            </button>
            <button
              onClick={useScan}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white active:scale-95 transition-transform"
            >
              <CheckCircle size={16} />
              Use This
            </button>
          </div>
        )}

        {phase === 'processing' && (
          <div className="flex justify-center py-2">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        )}
      </div>
    </div>
  )
}
