require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
app.use(cors())
app.use(express.json())

// Ensure uploads directories exist
const uploadsBase = path.join(__dirname, '../uploads')
const invoicesDir = path.join(uploadsBase, 'invoices')
const partsDir = path.join(uploadsBase, 'parts')
const inventoryDir = path.join(uploadsBase, 'inventory')
const locationDir = path.join(uploadsBase, 'location')
const privateDir = path.join(uploadsBase, 'private')
const srcDir = path.join(uploadsBase, 'src')
;[uploadsBase, invoicesDir, partsDir, inventoryDir, locationDir, privateDir, srcDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
})

app.use('/uploads', express.static(uploadsBase))

const authRoutes = require('./routes/auth')
const rosRoutes = require('./routes/ros')
const partsRoutes = require('./routes/parts')
const productionRoutes = require('./routes/production')
const invoicesRoutes = require('./routes/invoices')
const srcRoutes = require('./routes/src')
const vendorsRoutes = require('./routes/vendors')
const usersRoutes = require('./routes/users')
const importRoutes = require('./routes/import')
const adminRoutes  = require('./routes/admin')
const telegramRoutes = require('./routes/telegram')
const inventoryRoutes = require('./routes/inventory')
const privateRoutes = require('./routes/private')
const bmwRoutes = require('./routes/bmw')
const supplementsRoutes = require('./routes/supplements')
const carriersRoutes    = require('./routes/carriers')
const tasksRoutes       = require('./routes/tasks')
const connectRoutes     = require('./routes/connect')

app.use('/api/auth', authRoutes)
app.use('/api/ros', rosRoutes)
app.use('/api/parts', partsRoutes)
app.use('/api/production', productionRoutes)
app.use('/api/invoices', invoicesRoutes)
app.use('/api/src', srcRoutes)
app.use('/api/vendors', vendorsRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/import', importRoutes)
app.use('/api/admin',  adminRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/private', privateRoutes)
app.use('/api/bmw', bmwRoutes)
app.use('/api/supplements', supplementsRoutes)
app.use('/api/carriers',    carriersRoutes)
app.use('/api/tasks',       tasksRoutes)
app.use('/api/connect',     connectRoutes)

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

// SMS Consent / Opt-in Policy page (used for Twilio A2P registration)
app.get('/sms-policy', (req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SMS Opt-In Policy — Towne Body Shop</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 60px auto; padding: 0 24px; color: #1e293b; line-height: 1.7; }
    h1 { font-size: 1.6rem; margin-bottom: 4px; }
    h2 { font-size: 1.1rem; margin-top: 32px; color: #0ea5e9; }
    p, li { font-size: 0.97rem; color: #334155; }
    ul { padding-left: 20px; }
    .badge { display: inline-block; background: #f0f9ff; border: 1px solid #bae6fd; color: #0284c7; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; margin-bottom: 24px; }
    footer { margin-top: 48px; font-size: 0.82rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>SMS Opt-In Policy</h1>
  <div class="badge">Towne Body Shop — Linden, NJ</div>

  <h2>How We Collect Consent</h2>
  <p>Towne Body Shop collects customer mobile phone numbers at the time of vehicle drop-off as part of our standard intake process. Before recording a phone number for SMS communication, a staff member verbally informs the customer:</p>
  <ul>
    <li>That they may receive text message updates about their vehicle repair or rental</li>
    <li>That message frequency varies based on repair status</li>
    <li>That they can opt out at any time by replying <strong>STOP</strong></li>
  </ul>
  <p>Customer consent is confirmed verbally before any messages are sent. Phone numbers are never shared with third parties or used for marketing purposes.</p>

  <h2>Types of Messages Sent</h2>
  <ul>
    <li>Vehicle repair status updates</li>
    <li>Parts arrival notifications</li>
    <li>Vehicle ready for pickup alerts</li>
    <li>Rental vehicle reminders and updates</li>
    <li>Responses to customer inquiries</li>
  </ul>

  <h2>Opt-Out Instructions</h2>
  <p>Customers can opt out of SMS messages at any time by replying <strong>STOP</strong> to any message. After opting out, no further messages will be sent to that number. Customers may also call or email us directly to be removed.</p>

  <h2>Message Frequency &amp; Costs</h2>
  <p>Message frequency varies depending on the status of the customer's vehicle repair or rental. Standard message and data rates may apply depending on the customer's mobile carrier plan.</p>

  <h2>Contact Us</h2>
  <p>Towne Body Shop<br/>
  Linden, NJ<br/>
  For questions about SMS communications, reply STOP to opt out or contact us directly.</p>

  <footer>This page describes Towne Body Shop's SMS customer communication opt-in practices as required by US carrier A2P 10DLC registration guidelines.</footer>
</body>
</html>`)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Towne Parts API running on port ${PORT}`))
