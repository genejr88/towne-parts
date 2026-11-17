// Tech headshots live in Towne Tools (its crew list); Parts reads them through Tools' public kiosk
// endpoint and sets them through Tools' admin hub (TOWNE_ADMIN_KEY, same key on both apps).
// The two apps spell some names differently, so a few are aliased (Parts name → Tools name).
const TOOLS_URL = process.env.TOOLS_URL || 'https://tools.towneapps.com'
const NAME_ALIASES = { igor: 'ihor', kosta: 'konstantin', kostya: 'konstantin', andrii: 'andrei', andriy: 'andrei' }
let crewCache = { at: 0, photos: {} }
async function crewPhotos() {
  if (Date.now() - crewCache.at < 10 * 60_000) return crewCache.photos
  try {
    const r = await fetch(`${TOOLS_URL}/api/tools/employees`, { signal: AbortSignal.timeout(4000) })
    const j = await r.json()
    const photos = {}
    for (const e of j.data || []) if (e.photoUrl) photos[e.name.trim().toLowerCase()] = e.photoUrl
    crewCache = { at: Date.now(), photos }
  } catch { crewCache.at = Date.now() - 9 * 60_000 } // Tools unreachable: try again in a minute, keep old photos
  return crewCache.photos
}
function photoFor(photos, tech, size = 160) {
  const n = String(tech || '').trim().toLowerCase()
  if (!n) return null
  const first = n.split(/s+/)[0]
  let url = photos[n] || photos[NAME_ALIASES[n]] || photos[first] || photos[NAME_ALIASES[first]] || null
  // Cloudinary: ask for a small square face crop instead of the full photo
  if (url && url.includes('/image/upload/')) url = url.replace('/image/upload/', `/image/upload/c_thumb,g_face,w_${size},h_${size}/`)
  return url
}

const clearCrewCache = () => { crewCache = { at: 0, photos: {} } }

// Names to try in Tools for a Parts tech: their own name first, then the alias
const toolsNames = (tech) => {
  const n = String(tech || '').trim()
  const alias = NAME_ALIASES[n.toLowerCase()]
  return alias ? [n, alias.charAt(0).toUpperCase() + alias.slice(1)] : [n]
}

async function setCrewPhoto(tech, image) {
  const key = process.env.TOWNE_ADMIN_KEY
  if (!key) throw Object.assign(new Error('TOWNE_ADMIN_KEY is not set on Towne Parts.'), { status: 503 })
  const r = await fetch(`${TOOLS_URL}/api/admin-hub/crew-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-towne-admin-key': key },
    body: JSON.stringify({ names: toolsNames(tech), image }),
    signal: AbortSignal.timeout(30000),
  })
  const j = await r.json().catch(() => ({ success: false, error: `Towne Tools answered ${r.status}` }))
  if (!j.success) throw Object.assign(new Error(j.error || 'Towne Tools refused the photo'), { status: 502 })
  clearCrewCache()
  return j.data
}

module.exports = { crewPhotos, photoFor, clearCrewCache, setCrewPhoto }
