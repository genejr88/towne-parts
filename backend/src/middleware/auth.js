const jwt = require('jsonwebtoken')
const prisma = require('../lib/prisma')

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required.' })
  }

  const token = authHeader.slice(7)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'towneparts-secret')

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, role: true },
    })

    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found.' })
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    }
    next()
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token.' })
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Admin access required.' })
  }
  next()
}

module.exports = { requireAuth, requireAdmin }
