const express = require('express')
const https = require('https')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

function envCheck() {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_BILLY_USER_ID } = process.env
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TELEGRAM_BILLY_USER_ID) {
    const missing = [
      !TELEGRAM_BOT_TOKEN && 'TELEGRAM_BOT_TOKEN',
      !TELEGRAM_CHAT_ID && 'TELEGRAM_CHAT_ID',
      !TELEGRAM_BILLY_USER_ID && 'TELEGRAM_BILLY_USER_ID',
    ].filter(Boolean)
    return { ok: false, missing }
  }
  return { ok: true }
}

function billyMention() {
  return `<a href="tg://user?id=${process.env.TELEGRAM_BILLY_USER_ID}">Billy</a>`
}

function vehicleLine(ro) {
  return [ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ')
}

function sendTelegramMessage(text) {
  const body = JSON.stringify({
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const httpReq = https.request(options, (httpRes) => {
      let data = ''
      httpRes.on('data', (chunk) => { data += chunk })
      httpRes.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (!parsed.ok) reject(new Error(parsed.description || 'Telegram API error'))
          else resolve(parsed)
        } catch {
          reject(new Error('Invalid response from Telegram API'))
        }
      })
    })

    httpReq.on('error', reject)
    httpReq.write(body)
    httpReq.end()
  })
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/telegram/aph/:roId — send "All Parts Here" message for an RO
router.post('/aph/:roId', requireAuth, async (req, res) => {
  const env = envCheck()
  if (!env.ok) {
    return res.status(503).json({
      success: false,
      error: `Telegram not configured. Missing env vars: ${env.missing.join(', ')}`,
    })
  }

  try {
    const ro = await prisma.rO.findUnique({
      where: { id: parseInt(req.params.roId) },
      select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true },
    })

    if (!ro) return res.status(404).json({ success: false, error: 'RO not found' })

    const roLink = `https://parts.towneapps.com/ros/${ro.id}`
    const text = `${ro.roNumber} ${vehicleLine(ro)}: ${billyMention()} All parts are here 🟢\n${roLink}`

    await sendTelegramMessage(text)
    return res.json({ success: true, data: { message: 'Telegram message sent' } })
  } catch (err) {
    console.error('Telegram APH error:', err)
    return res.status(500).json({ success: false, error: err.message || 'Failed to send Telegram message' })
  }
})

// POST /api/telegram/part/:partId — send "this individual part is here" message
router.post('/part/:partId', requireAuth, async (req, res) => {
  const env = envCheck()
  if (!env.ok) {
    return res.status(503).json({
      success: false,
      error: `Telegram not configured. Missing env vars: ${env.missing.join(', ')}`,
    })
  }

  try {
    const part = await prisma.part.findUnique({
      where: { id: parseInt(req.params.partId) },
      include: {
        ro: {
          select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true },
        },
      },
    })

    if (!part || !part.ro) {
      return res.status(404).json({ success: false, error: 'Part not found' })
    }

    const ro = part.ro
    const roLink = `https://parts.towneapps.com/ros/${ro.id}`
    const partLabel =
      [part.partNumber, part.description].filter(Boolean).join(' — ') || 'Part'
    const qtySuffix = part.qty && part.qty > 1 ? ` ×${part.qty}` : ''

    const text = `${ro.roNumber} ${vehicleLine(ro)}: ${billyMention()} ${partLabel}${qtySuffix} is here 🟢\n${roLink}`

    await sendTelegramMessage(text)
    return res.json({ success: true, data: { message: 'Telegram message sent' } })
  } catch (err) {
    console.error('Telegram part error:', err)
    return res.status(500).json({ success: false, error: err.message || 'Failed to send Telegram message' })
  }
})

module.exports = router
