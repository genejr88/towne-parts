import { Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/lib/auth'
import AppLayout from '@/components/layout/AppLayout'
import Spinner from '@/components/ui/Spinner'

import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import ROList from '@/pages/ROList'
import RODetail from '@/pages/RODetail'
import ProductionBoard from '@/pages/ProductionBoard'
import SRCTracker from '@/pages/SRCTracker'
import Admin from '@/pages/Admin'
import Inventory from '@/pages/Inventory'

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center animate-pulse">
            <Spinner size="sm" className="text-white" />
          </div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (adminOnly && user.role !== 'ADMIN') {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-24 gap-4 px-4">
          <p className="text-2xl font-bold text-gray-100">Access Denied</p>
          <p className="text-gray-400 text-center">You need admin permissions to view this page.</p>
        </div>
      </AppLayout>
    )
  }

  return children
}

export default function App() {
  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={
          <ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>
        } />
        <Route path="/ros" element={
          <ProtectedRoute><AppLayout><ROList /></AppLayout></ProtectedRoute>
        } />
        <Route path="/ros/:id" element={
          <ProtectedRoute><AppLayout><RODetail /></AppLayout></ProtectedRoute>
        } />
        <Route path="/board" element={
          <ProtectedRoute><AppLayout><ProductionBoard /></AppLayout></ProtectedRoute>
        } />
        <Route path="/src" element={
          <ProtectedRoute><AppLayout><SRCTracker /></AppLayout></ProtectedRoute>
        } />
        <Route path="/admin" element={
          <ProtectedRoute adminOnly><AppLayout><Admin /></AppLayout></ProtectedRoute>
        } />
        <Route path="/inventory" element={
          <ProtectedRoute><AppLayout><Inventory /></AppLayout></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/ros" replace />} />
      </Routes>
    </AnimatePresence>
  )
}
