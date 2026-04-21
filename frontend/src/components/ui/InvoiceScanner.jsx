import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { jsPDF } from 'jspdf'
import { RotateCcw, CheckCircle, X, Loader2, ScanLine, ZapOff, FileText, Image } from 'lucide-react'

/**
 * Adaptive threshold — turns a photo into a crisp black-and-white scanned document.
 * Uses an integral image for fast O(n) local mean computation.
 */
function applyDocumentScan(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { width, height } = canvas

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const len = width * height

  // 1 — Grayscale
  const gray = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    const p = i * 4
    gray[i] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2])
  }

  // 2 — Integral image (enables O(1) rectangle sum lookups)
  const W1 = width + 1
  const integral = new Int32Array(W1 * (height + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y + 1) * W1 + (x + 1)
      integral[idx] =
        gray[y * width + x] +
        integral[y * W1 + (x + 1)] +
        integral[(y + 1) * W1 + x] -
        integral[y * W1 + x]
    }
  }

  // 3 — Adaptive threshold per pixel
  //   BLOCK: neighbourhood size — larger handles uneven lighting better
  //   C:     subtract from local mean — higher = more aggressive B&W cutoff
  const BLOCK = 31
  const C = 12
  const half = Math.floor(BLOCK / 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - half)
      const y1 = Math.max(0, y - half)
      const x2 = Math.min(width - 1, x + half)
      const y2 = Math.min(height - 1, y + half)

      const count = (x2 - x1 + 1) * (y2 - y1 + 1)
      const sum =
        integral[(y2 + 1) * W1 + (x2 + 1)] -
        integral[y1 * W1 + (x2 + 1)] -
        integral[(y2 + 1) * W1 + x1] +
        integral[y1 * W1 + x1]

      const localMean = sum / count
      const val = gray[y * width + x] < localMean - C ? 0 : 255

      const p = (y * width + x) * 4
      data[p] = data[p + 1] = data[p + 2] = val
      data[p + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Scale canvas down if wider than maxW (preserves aspect ratio).
 * Returns a new canvas at the scaled size.
 */
function scaleCanvas(srcCanvas, maxW = 1600) {
  if (srcCanvas.width <= maxW) return srcCanvas
  const scale = maxW / srcCanvas.width
  const dst = document.createElement('canvas')
  dst.width = Math.round(srcCanvas.width * scale)
  dst.height = Math.round(srcCanvas.height * scale)
  dst.getContext('2d').drawImage(srcCanvas, 0, 0, dst.width, dst.height)
  return dst
}

export default function InvoiceScanner({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  // phase: starting | live | processing | captured | error
  const [phase, setPhase] = useState('starting')
  const [capturedDataUrl, setCapturedDataUrl] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [mode, setMode] = useState('document') // 'document' | 'photo'

  // ── Camera ─────────────────────────────────────────────────────────────────
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

  // ── Capture + process ──────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    // Stop stream first
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setPhase('processing')

    // Give React a frame to render the spinner before the heavy work
    setTimeout(() => {
      try {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)

        let workCanvas = canvas

        if (mode === 'document') {
          // Scale down before processing so the algorithm is fast
          workCanvas = scaleCanvas(canvas, 1600)
          applyDocumentScan(workCanvas)
        }

        const quality = mode === 'document' ? 0.95 : 0.88
        const dataUrl = workCanvas.toDataURL('image/jpeg', quality)
        setCapturedDataUrl(dataUrl)
        setPhase('captured')
      } catch (err) {
        console.error('Capture failed:', err)
        setErrorMsg('Processing failed. Try again.')
        setPhase('error')
      }
    }, 80)
  }, [mode])

  const retake = () => {
    setCapturedDataUrl(null)
    startCamera()
  }

  // ── Generate PDF ───────────────────────────────────────────────────────────
  const useScan = async () => {
    setPhase('processing')
    try {
      const img = new Image()
      img.src = capturedDataUrl
      await new Promise((res) => { img.onload = res })

      const orientation = img.naturalHeight > img.naturalWidth ? 'portrait' : 'landscape'
      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pageW / img.naturalWidth, pageH / img.naturalHeight)
      const dw = img.naturalWidth * ratio
      const dh = img.naturalHeight * ratio

      pdf.addImage(capturedDataUrl, 'JPEG', (pageW - dw) / 2, (pageH - dh) / 2, dw, dh)

      const blob = pdf.output('blob')
      const file = new File([blob], `invoice_scan_${Date.now()}.pdf`, { type: 'application/pdf' })
      onCapture(file)
      onClose()
    } catch (err) {
      console.error('PDF error:', err)
      setErrorMsg('Failed to generate PDF. Please try again.')
      setPhase('captured')
    }
  }

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
        </div>
        <button
          onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); onClose() }}
          className="p-2 text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative overflow-hidden bg-black">

        {/* Live video */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            phase === 'live' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* Corner guides */}
        {phase === 'live' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[88%] max-w-xs aspect-[8.5/11] relative">
              {[
                'top-0 left-0 border-t-2 border-l-2 rounded-tl',
                'top-0 right-0 border-t-2 border-r-2 rounded-tr',
                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl',
                'bottom-0 right-0 border-b-2 border-r-2 rounded-br',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-7 h-7 border-blue-400 ${cls}`} />
              ))}
              <motion.div
                animate={{ top: ['5%', '92%', '5%'] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-0 right-0 h-px bg-blue-400/70"
                style={{ boxShadow: '0 0 10px 3px rgba(96,165,250,0.35)' }}
              />
            </div>
            <p className="absolute bottom-28 text-xs text-gray-500 text-center px-8">
              Align invoice within the frame — hold steady
            </p>
          </div>
        )}

        {/* Scanned preview */}
        {phase === 'captured' && capturedDataUrl && (
          <img
            src={capturedDataUrl}
            alt="Scanned invoice"
            className="absolute inset-0 w-full h-full object-contain bg-white"
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
            <button
              onClick={startCamera}
              className="px-5 py-2.5 bg-gray-700 rounded-xl text-sm font-semibold text-white"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="shrink-0 bg-black/90 px-6 pb-10 pt-4">

        {phase === 'live' && (
          <div className="flex items-center justify-between">
            {/* Mode toggle */}
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => setMode(mode === 'document' ? 'photo' : 'document')}
                className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-colors ${
                  mode === 'document'
                    ? 'border-blue-400 bg-blue-400/10'
                    : 'border-gray-600 bg-gray-800'
                }`}
              >
                {mode === 'document' ? (
                  <FileText size={16} className="text-blue-400" />
                ) : (
                  <Image size={16} className="text-gray-400" />
                )}
              </button>
              <span className={`text-[10px] font-medium ${mode === 'document' ? 'text-blue-400' : 'text-gray-500'}`}>
                {mode === 'document' ? 'Doc' : 'Photo'}
              </span>
            </div>

            {/* Shutter */}
            <button
              onClick={capture}
              className="rounded-full bg-white active:scale-95 transition-transform shadow-lg"
              style={{ width: 72, height: 72 }}
            >
              <div className="w-full h-full rounded-full bg-white border-[5px] border-gray-300" />
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
