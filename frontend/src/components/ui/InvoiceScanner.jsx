import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { jsPDF } from 'jspdf'
import { Camera, RotateCcw, CheckCircle, X, Loader2, ScanLine, ZapOff } from 'lucide-react'

/**
 * InvoiceScanner
 * Opens the device camera (rear-facing on mobile), lets the user capture a photo,
 * applies contrast enhancement, then generates a PDF and calls onCapture(file).
 *
 * Props:
 *   onCapture(file: File) — called with the generated PDF File
 *   onClose()             — called when the modal is dismissed
 */
export default function InvoiceScanner({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [phase, setPhase] = useState('starting') // starting | live | captured | processing | error
  const [capturedDataUrl, setCapturedDataUrl] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [enhance, setEnhance] = useState(true) // toggle contrast/grayscale enhancement

  // ── Start camera ────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setPhase('starting')
    setErrorMsg('')
    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPhase('live')
    } catch (err) {
      console.error('Camera error:', err)
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
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [startCamera])

  // ── Capture frame ───────────────────────────────────────────────────────────
  const capture = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')

    if (enhance) {
      // Draw with contrast + brightness boost (document scanning look)
      ctx.filter = 'contrast(1.4) brightness(1.05)'
    }
    ctx.drawImage(video, 0, 0)
    ctx.filter = 'none'

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setCapturedDataUrl(dataUrl)
    setPhase('captured')

    // Stop camera stream to save battery
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  // ── Retake ──────────────────────────────────────────────────────────────────
  const retake = () => {
    setCapturedDataUrl(null)
    startCamera()
  }

  // ── Generate PDF and return ─────────────────────────────────────────────────
  const useScan = async () => {
    setPhase('processing')
    try {
      const img = new Image()
      img.src = capturedDataUrl
      await new Promise((res) => { img.onload = res })

      const imgW = img.naturalWidth
      const imgH = img.naturalHeight

      // Choose orientation based on aspect ratio
      const orientation = imgH > imgW ? 'portrait' : 'landscape'
      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()

      // Fit image to page preserving aspect ratio
      const ratio = Math.min(pageW / imgW, pageH / imgH)
      const drawW = imgW * ratio
      const drawH = imgH * ratio
      const x = (pageW - drawW) / 2
      const y = (pageH - drawH) / 2

      pdf.addImage(capturedDataUrl, 'JPEG', x, y, drawW, drawH)

      const blob = pdf.output('blob')
      const filename = `invoice_scan_${Date.now()}.pdf`
      const file = new File([blob], filename, { type: 'application/pdf' })

      onCapture(file)
      onClose()
    } catch (err) {
      console.error('PDF generation failed:', err)
      setErrorMsg('Failed to generate PDF. Please try again.')
      setPhase('captured')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black flex flex-col"
      >
        {/* Hidden canvas for capture */}
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
            onClick={() => {
              streamRef.current?.getTracks().forEach((t) => t.stop())
              onClose()
            }}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Main area */}
        <div className="flex-1 relative overflow-hidden bg-black">

          {/* Live camera */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              phase === 'live' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />

          {/* Scan overlay guide — only in live mode */}
          {phase === 'live' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[85%] max-w-sm aspect-[8.5/11] relative">
                {/* Corner markers */}
                {[
                  'top-0 left-0 border-t-2 border-l-2 rounded-tl-md',
                  'top-0 right-0 border-t-2 border-r-2 rounded-tr-md',
                  'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-md',
                  'bottom-0 right-0 border-b-2 border-r-2 rounded-br-md',
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-6 h-6 border-blue-400 ${cls}`} />
                ))}
                {/* Scanning line animation */}
                <motion.div
                  animate={{ top: ['8%', '88%', '8%'] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-0 right-0 h-px bg-blue-400/60"
                  style={{ boxShadow: '0 0 8px 2px rgba(96,165,250,0.4)' }}
                />
              </div>
              <p className="absolute bottom-24 text-xs text-gray-400 text-center px-8">
                Align invoice within the frame
              </p>
            </div>
          )}

          {/* Captured preview */}
          {phase === 'captured' && capturedDataUrl && (
            <img
              src={capturedDataUrl}
              alt="Captured scan"
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}

          {/* Starting / processing spinner */}
          {(phase === 'starting' || phase === 'processing') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 size={32} className="animate-spin text-blue-400" />
              <p className="text-sm text-gray-400">
                {phase === 'starting' ? 'Starting camera…' : 'Generating PDF…'}
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
                className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm font-semibold text-white transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div className="shrink-0 bg-black/90 px-6 pb-10 pt-4">
          {phase === 'live' && (
            <div className="flex items-center justify-between">
              {/* Enhance toggle */}
              <button
                onClick={() => setEnhance(!enhance)}
                className={`flex flex-col items-center gap-1 text-xs transition-colors ${
                  enhance ? 'text-blue-400' : 'text-gray-600'
                }`}
              >
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors ${
                  enhance ? 'border-blue-400 bg-blue-400/10' : 'border-gray-700 bg-gray-800'
                }`}>
                  <ScanLine size={16} />
                </div>
                Enhance
              </button>

              {/* Capture button */}
              <button
                onClick={capture}
                className="w-18 h-18 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                style={{ width: 72, height: 72 }}
              >
                <div className="w-14 h-14 rounded-full bg-white border-4 border-gray-300" />
              </button>

              {/* Spacer */}
              <div className="w-10" />
            </div>
          )}

          {phase === 'captured' && (
            <div className="flex items-center gap-3">
              <button
                onClick={retake}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gray-800 border border-gray-700 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors active:scale-95"
              >
                <RotateCcw size={16} />
                Retake
              </button>
              <button
                onClick={useScan}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white transition-colors active:scale-95"
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
      </motion.div>
    </AnimatePresence>
  )
}
