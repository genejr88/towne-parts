import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { User, Lock, ArrowRight } from 'lucide-react'
import TurboIcon from '@/components/ui/TurboIcon'
import toast from 'react-hot-toast'
import { useAuth } from '@/lib/auth'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !password) {
      toast.error('Please enter your username and password')
      return
    }
    setLoading(true)
    try {
      await login(username, password)
      navigate('/ros')
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -20, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-40 -left-20 w-[500px] h-[500px] rounded-full bg-blue-600/8 blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -20, 0], y: [0, 30, 0], scale: [1, 1.05, 1] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute -bottom-40 -right-20 w-[500px] h-[500px] rounded-full bg-blue-500/6 blur-3xl"
        />
      </div>

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'linear-gradient(rgba(59,130,246,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative w-full max-w-sm"
      >
        <div className="rounded-3xl border border-gray-700/60 bg-gray-900/80 backdrop-blur-xl shadow-2xl p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-glow mb-4"
            >
              <TurboIcon size={30} className="text-white" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-center"
            >
              <h1 className="text-3xl font-extrabold text-gray-100 tracking-tight">
                Towne<span className="text-blue-400">Parts</span>
              </h1>
              <p className="text-sm text-gray-500 mt-1">Parts tracking & production board</p>
            </motion.div>
          </div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
          >
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your username"
              icon={<User size={16} />}
              autoComplete="username"
              autoFocus
              autoCapitalize="none"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              icon={<Lock size={16} />}
              autoComplete="current-password"
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="mt-2 w-full justify-center"
            >
              Sign in
              {!loading && <ArrowRight size={18} />}
            </Button>
          </motion.form>
        </div>

        <p className="text-center text-xs text-gray-700 mt-4">
          Towne Body Shop · Parts Management
        </p>
      </motion.div>
    </div>
  )
}
