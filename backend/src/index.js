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
;[uploadsBase, invoicesDir, partsDir].forEach((dir) => {
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

app.use('/api/auth', authRoutes)
app.use('/api/ros', rosRoutes)
app.use('/api/parts', partsRoutes)
app.use('/api/production', productionRoutes)
app.use('/api/invoices', invoicesRoutes)
app.use('/api/src', srcRoutes)
app.use('/api/vendors', vendorsRoutes)
app.use('/api/users', usersRoutes)

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Towne Parts API running on port ${PORT}`))
