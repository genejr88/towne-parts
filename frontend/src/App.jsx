import { Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/lib/auth'
import AppLayout from '@/components/layout/AppLayout'
import Spinner from '@/components/ui/Spinner'

import Login from '@/pages/Login'
import PublicReturns from '@/pages/PublicReturns'
import Dashboard from '@/pages/Dashboard'
import ROList from '@/pages/ROList'
import RODetail from '@/pages/RODetail'
import ProductionBoard from '@/pages/ProductionBoard'
import SRCTracker from '@/pages/SRCTracker'
import Admin from '@/pages/Admin'
import Inventory from '@/pages/Inventory'
import SecureVault from '@/pages/SecureVault'
import RecentActivity from '@/pages/RecentActivity'
import Help from '@/pages/Help'
import Supplements from '@/pages/Supplements'
import CarrierHistory from '@/pages/CarrierHistory'
import StatusLog from '@/pages/StatusLog'

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

function SMSTerms() {
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', maxWidth: 680, margin: '60px auto', padding: '0 24px', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>SMS Terms &amp; Conditions</h1>
      <div style={{ display: 'inline-block', background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0284c7', padding: '4px 12px', borderRadius: 20, fontSize: '0.85rem', marginBottom: 24 }}>
        Towne Body Shop — Linden, NJ
      </div>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Program Description</h2>
      <p style={{ color: '#334155' }}>Towne Body Shop operates an SMS notification program ("Program") to send customers transactional text message updates regarding their vehicle repair status, parts arrival, vehicle readiness for pickup, loaner/rental vehicle reminders, and responses to customer inquiries.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>How to Opt In</h2>
      <p style={{ color: '#334155' }}>Customers opt in to the Program at the time of vehicle drop-off. A Towne Body Shop staff member verbally explains the Program and asks the customer if they consent to receive SMS updates. By providing their mobile phone number and verbally agreeing, the customer consents to receive text messages from Towne Body Shop. An enrollment confirmation SMS is sent at the time of opt-in.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>How to Opt Out</h2>
      <p style={{ color: '#334155' }}>You may opt out of the Program at any time by replying <strong>STOP</strong> to any message. After texting STOP, you will receive one final confirmation message and no further messages will be sent. To re-enroll, contact us directly at the shop.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Help</h2>
      <p style={{ color: '#334155' }}>For assistance, reply <strong>HELP</strong> to any message or contact Towne Body Shop directly.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Message Frequency</h2>
      <p style={{ color: '#334155' }}>Message frequency varies and depends on the status of your vehicle repair or rental. You may receive multiple messages per visit during active repair or rental periods.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Message &amp; Data Rates</h2>
      <p style={{ color: '#334155' }}>Standard message and data rates may apply depending on your mobile carrier plan. Towne Body Shop does not charge for SMS messages.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Types of Messages</h2>
      <ul style={{ color: '#334155', paddingLeft: 20 }}>
        <li>Vehicle repair status updates</li>
        <li>Parts arrival notifications</li>
        <li>Vehicle ready for pickup alerts</li>
        <li>Loaner/rental vehicle reminders and updates</li>
        <li>Responses to customer inquiries (two-way SMS)</li>
      </ul>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Privacy</h2>
      <p style={{ color: '#334155' }}>Customer mobile phone numbers collected for this Program are used solely for SMS communications related to vehicle repair and rental services. Phone numbers are never sold, shared with third parties, or used for marketing purposes. View our full SMS opt-in policy at <a href="https://parts.towneapps.com/sms-policy" style={{ color: '#0284c7' }}>parts.towneapps.com/sms-policy</a>.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Contact</h2>
      <p style={{ color: '#334155' }}>Towne Body Shop<br />Linden, NJ<br />Reply STOP to opt out or HELP for assistance at any time.</p>
      <div style={{ marginTop: 48, fontSize: '0.82rem', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
        These Terms &amp; Conditions govern Towne Body Shop's A2P 10DLC SMS messaging program as required by US carrier registration guidelines.
      </div>
    </div>
  )
}

function SMSPolicy() {
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', maxWidth: 680, margin: '60px auto', padding: '0 24px', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>SMS Opt-In Policy</h1>
      <div style={{ display: 'inline-block', background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0284c7', padding: '4px 12px', borderRadius: 20, fontSize: '0.85rem', marginBottom: 24 }}>
        Towne Body Shop — Linden, NJ
      </div>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>How We Collect Consent</h2>
      <p style={{ color: '#334155' }}>Towne Body Shop collects customer mobile phone numbers at the time of vehicle drop-off as part of our standard intake process. Before recording a phone number for SMS communication, a staff member verbally informs the customer:</p>
      <ul style={{ color: '#334155', paddingLeft: 20 }}>
        <li>That they may receive text message updates about their vehicle repair or rental</li>
        <li>That message frequency varies based on repair status</li>
        <li>That they can opt out at any time by replying <strong>STOP</strong></li>
      </ul>
      <p style={{ color: '#334155' }}>Customer consent is confirmed verbally before any messages are sent. Phone numbers are never shared with third parties or used for marketing purposes.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Types of Messages Sent</h2>
      <ul style={{ color: '#334155', paddingLeft: 20 }}>
        <li>Vehicle repair status updates</li>
        <li>Parts arrival notifications</li>
        <li>Vehicle ready for pickup alerts</li>
        <li>Rental vehicle reminders and updates</li>
        <li>Responses to customer inquiries via two-way SMS</li>
      </ul>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Opt-Out Instructions</h2>
      <p style={{ color: '#334155' }}>Customers can opt out of SMS messages at any time by replying <strong>STOP</strong> to any message. No further messages will be sent after opting out.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Message Frequency &amp; Costs</h2>
      <p style={{ color: '#334155' }}>Message frequency varies depending on repair or rental status. Standard message and data rates may apply.</p>
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, color: '#0ea5e9' }}>Contact Us</h2>
      <p style={{ color: '#334155' }}>Towne Body Shop, Linden, NJ. Reply STOP to opt out at any time.</p>
      <div style={{ marginTop: 48, fontSize: '0.82rem', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
        This page describes Towne Body Shop's SMS customer communication opt-in practices as required by US carrier A2P 10DLC registration guidelines.
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/src/public" element={<PublicReturns />} />
        <Route path="/sms-policy" element={<SMSPolicy />} />
        <Route path="/terms" element={<SMSTerms />} />

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
        <Route path="/board/log" element={
          <ProtectedRoute><AppLayout><StatusLog /></AppLayout></ProtectedRoute>
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
        <Route path="/vault" element={
          <ProtectedRoute><AppLayout><SecureVault /></AppLayout></ProtectedRoute>
        } />
        <Route path="/recent" element={
          <ProtectedRoute><AppLayout><RecentActivity /></AppLayout></ProtectedRoute>
        } />
        <Route path="/supplements" element={
          <ProtectedRoute><AppLayout><Supplements /></AppLayout></ProtectedRoute>
        } />
        <Route path="/carriers" element={
          <ProtectedRoute><AppLayout><CarrierHistory /></AppLayout></ProtectedRoute>
        } />
        <Route path="/help" element={
          <ProtectedRoute><AppLayout><Help /></AppLayout></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/ros" replace />} />
      </Routes>
    </AnimatePresence>
  )
}
