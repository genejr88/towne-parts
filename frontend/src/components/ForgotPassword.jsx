import { useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../lib/api'

// "Forgot password?" link + PIN-gated reset dialog. Backend: backend/src/routes/passwordReset.js
// The dialog is portaled to <body> so a blurred/transformed login card can't trap the fixed overlay.
export default function ForgotPassword() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState('pin') // pin -> reset -> done
  const [pin, setPin] = useState('')
  const [users, setUsers] = useState([])
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [doneFor, setDoneFor] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    setOpen(false); setStep('pin'); setPin(''); setUsers([]); setUserId('')
    setPassword(''); setConfirm(''); setDoneFor(''); setError('')
  }

  const call = async (fn) => {
    setBusy(true); setError('')
    try { await fn() } catch (err) {
      setError(err.response?.data?.error || err.message || 'Something went wrong')
    } finally { setBusy(false) }
  }

  const verifyPin = (e) => {
    e.preventDefault()
    call(async () => {
      const res = await api.post('/auth/reset/verify-pin', { pin })
      setUsers(res.data.data)
      setStep('reset')
    })
  }

  const reset = (e) => {
    e.preventDefault()
    if (!userId) return setError('Pick an account')
    if (password.length < 6) return setError('Password must be at least 6 characters')
    if (password !== confirm) return setError('Passwords do not match')
    call(async () => {
      const res = await api.post('/auth/reset', { pin, userId, newPassword: password })
      setDoneFor(res.data.data.username)
      setStep('done')
    })
  }

  const field = 'w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500'
  const button = 'w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-4 py-2.5 font-semibold text-white'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block mx-auto mt-4 text-sm text-slate-400 hover:text-sky-400">
        Forgot password?
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl text-left" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-100">Reset password</h2>
              <button type="button" onClick={close} className="text-slate-400 hover:text-slate-200 text-xl leading-none" aria-label="Close">×</button>
            </div>

            {step === 'pin' && (
              <form onSubmit={verifyPin} className="flex flex-col gap-3">
                <p className="text-sm text-slate-400">Enter the shop reset PIN.</p>
                <input className={field} type="password" inputMode="numeric" autoComplete="off" autoFocus
                  value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" />
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button className={button} disabled={busy || !pin}>{busy ? 'Checking…' : 'Continue'}</button>
              </form>
            )}

            {step === 'reset' && (
              <form onSubmit={reset} className="flex flex-col gap-3">
                <select className={field} value={userId} onChange={e => setUserId(e.target.value)} autoFocus>
                  <option value="">Choose account…</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name && u.name !== u.username ? `${u.username} (${u.name})` : u.username}</option>
                  ))}
                </select>
                <input className={field} type="password" autoComplete="new-password"
                  value={password} onChange={e => setPassword(e.target.value)} placeholder="New password" />
                <input className={field} type="password" autoComplete="new-password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" />
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button className={button} disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
              </form>
            )}

            {step === 'done' && (
              <div className="flex flex-col gap-4">
                <p className="text-slate-200">Password updated for <span className="font-semibold text-sky-400">{doneFor}</span>. Sign in with the new password.</p>
                <button type="button" className={button} onClick={close}>Back to sign in</button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
