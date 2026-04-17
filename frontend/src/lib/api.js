import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002'

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('parts_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('parts_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Helper to unwrap { success, data } envelope
function unwrap(promise) {
  return promise.then((res) => {
    if (res.data.success === false) {
      throw new Error(res.data.error || 'Unknown error')
    }
    return res.data.data !== undefined ? res.data.data : res.data
  })
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username, password) => unwrap(api.post('/auth/login', { username, password })),
  logout: () => unwrap(api.post('/auth/logout')),
  me: () => unwrap(api.get('/auth/me')),
}

// ── Repair Orders ─────────────────────────────────────────────────────────────
export const rosApi = {
  list: (params) => unwrap(api.get('/ros', { params })),
  get: (id) => unwrap(api.get(`/ros/${id}`)),
  create: (data) => unwrap(api.post('/ros', data)),
  update: (id, data) => unwrap(api.put(`/ros/${id}`, data)),
  archive: (id) => unwrap(api.delete(`/ros/${id}`)),
  unarchive: (id) => unwrap(api.post(`/ros/${id}/unarchive`)),
}

// ── Parts ─────────────────────────────────────────────────────────────────────
export const partsApi = {
  create: (roId, data) => unwrap(api.post(`/parts/ro/${roId}`, data)),
  update: (id, data) => unwrap(api.put(`/parts/${id}`, data)),
  remove: (id) => unwrap(api.delete(`/parts/${id}`)),
  bulkReceived: (roId) => unwrap(api.post(`/parts/bulk-received/${roId}`)),
  uploadPhoto: (partId, file) => {
    const form = new FormData()
    form.append('file', file)
    return unwrap(api.post(`/parts/${partId}/photos`, form, { headers: { 'Content-Type': 'multipart/form-data' } }))
  },
  deletePhoto: (photoId) => unwrap(api.delete(`/parts/photos/${photoId}`)),
  photoUrl: (storedPath) => `${API_URL}/uploads/parts/${storedPath}`,
}

// ── Production Board ──────────────────────────────────────────────────────────
export const productionApi = {
  list: () => unwrap(api.get('/production')),
  save: (roId, data) => unwrap(api.post(`/production/${roId}`, data)),
  activity: (date) => unwrap(api.get('/production/activity', { params: date ? { date } : {} })),
}

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoicesApi = {
  list: (roId) => unwrap(api.get(`/invoices/ro/${roId}`)),
  upload: (roId, file) => {
    const form = new FormData()
    form.append('file', file)
    return unwrap(
      api.post(`/invoices/ro/${roId}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    )
  },
  remove: (id) => unwrap(api.delete(`/invoices/${id}`)),
  fileUrl: (id) => `${API_URL}/api/invoices/${id}/file`,
}

// ── SRC (Supplement / Return / Core) ─────────────────────────────────────────
export const srcApi = {
  list: (params) => unwrap(api.get('/src', { params })),
  create: (roId, data) => unwrap(api.post(`/src/ro/${roId}`, data)),
  update: (id, data) => unwrap(api.put(`/src/${id}`, data)),
  remove: (id) => unwrap(api.delete(`/src/${id}`)),
}

// ── Vendors ───────────────────────────────────────────────────────────────────
export const vendorsApi = {
  list: () => unwrap(api.get('/vendors')),
  create: (data) => unwrap(api.post('/vendors', data)),
  update: (id, data) => unwrap(api.put(`/vendors/${id}`, data)),
  remove: (id) => unwrap(api.delete(`/vendors/${id}`)),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => unwrap(api.get('/users')),
  create: (data) => unwrap(api.post('/users', data)),
  remove: (id) => unwrap(api.delete(`/users/${id}`)),
}

// ── Telegram ──────────────────────────────────────────────────────────────────
export const telegramApi = {
  sendAPH: (roId) => unwrap(api.post(`/telegram/aph/${roId}`)),
}

// ── Import (CCC ONE estimate parser) ─────────────────────────────────────────
export const importApi = {
  parse: (file) => {
    const form = new FormData()
    form.append('file', file)
    return unwrap(api.post('/import/parse', form, { headers: { 'Content-Type': 'multipart/form-data' } }))
  },
  photoImport: (file) => {
    const form = new FormData()
    form.append('file', file)
    return unwrap(api.post('/import/photo', form, { headers: { 'Content-Type': 'multipart/form-data' } }))
  },
}

// ── Inventory (Surplus Parts Catalog) ────────────────────────────────────────
export const inventoryApi = {
  list: (search) => unwrap(api.get('/inventory', { params: search ? { search } : {} })),
  create: (data) => unwrap(api.post('/inventory', data)),
  update: (id, data) => unwrap(api.put(`/inventory/${id}`, data)),
  remove: (id) => unwrap(api.delete(`/inventory/${id}`)),
  uploadPhoto: (id, file) => {
    const fd = new FormData()
    fd.append('photo', file)
    return unwrap(api.post(`/inventory/${id}/photos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }))
  },
  deletePhoto: (photoId) => unwrap(api.delete(`/inventory/photos/${photoId}`)),
  photoUrl: (storedPath) => `${API_URL}/uploads/inventory/${storedPath}`,
}

export default api
