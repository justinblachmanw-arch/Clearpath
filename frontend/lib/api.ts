import axios from 'axios'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const api = axios.create({ baseURL: `${BASE}/api`, timeout: 30000 })

api.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('clearpath_token') || localStorage.getItem('clearpath_ma_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('clearpath_token')
      localStorage.removeItem('clearpath_provider')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Public API client — no auto-auth header
const publicApi = axios.create({ baseURL: `${BASE}/api`, timeout: 30000 })

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function apiLogin(email: string, password: string) {
  const r = await api.post('/auth/login', { email, password })
  return r.data as { token: string; provider: { id: number; name: string; email: string; specialty: string } }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function apiDashboard() {
  const r = await api.get('/dashboard')
  return r.data
}

// ─── Claims ───────────────────────────────────────────────────────────────────

export async function apiClaims(params?: { status?: string; payer?: string }) {
  const r = await api.get('/claims/action-items', { params })
  return r.data
}

export async function apiCreateClaim(data: Record<string, unknown>) {
  const r = await api.post('/claims', data)
  return r.data
}

// ─── Credentials ──────────────────────────────────────────────────────────────

export async function apiCredentials() {
  const r = await api.get('/credentials')
  return r.data
}

// ─── Financials ───────────────────────────────────────────────────────────────

export async function apiFinancials() {
  const r = await api.get('/financials/summary')
  return r.data
}

export async function apiMonthlyTrend() {
  const r = await api.get('/financials/monthly-trend')
  return r.data
}

export async function apiPayerTrend() {
  const r = await api.get('/financials/payer-trend')
  return r.data
}

export async function apiDenialTrend() {
  const r = await api.get('/claims/denial-trend')
  return r.data
}

// ─── Appointments ─────────────────────────────────────────────────────────────

export async function apiAppointment(id: string) {
  const r = await api.get(`/appointments/${id}`)
  return r.data
}

// ─── Patient Tablet — Public ──────────────────────────────────────────────────

export async function apiPatientLookup(params: {
  firstName: string
  lastName: string
  dob: string
  phoneLastFour?: string
}) {
  const r = await publicApi.get('/patients/lookup', { params })
  return r.data
}

export async function apiPatientRegister(data: {
  firstName: string
  lastName: string
  dob: string
  phone?: string
}) {
  const r = await publicApi.post('/patients/register', data)
  return r.data
}

export async function apiInsuranceExtract(frontImage: string, backImage?: string) {
  const r = await publicApi.post('/insurance/extract', { frontImage, backImage })
  return r.data as { extracted: Record<string, string | null> }
}

export async function apiSubmitIntake(appointmentId: number, data: Record<string, unknown>) {
  const r = await publicApi.post(`/intake/${appointmentId}`, data)
  return r.data
}

// ─── MA Tablet ────────────────────────────────────────────────────────────────

export async function apiMALogin(pin: string) {
  const r = await publicApi.post('/ma/login', { pin })
  return r.data as { token: string; ma: { id: number; name: string; providerId: number } }
}

export async function apiMASchedule(token: string) {
  const r = await axios.get(`${BASE}/api/ma/schedule`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return r.data
}

export async function apiSaveVitals(token: string, data: Record<string, unknown>) {
  const r = await axios.post(`${BASE}/api/vitals`, data, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return r.data
}

export async function apiCheckIn(token: string, appointmentId: number) {
  const r = await axios.post(`${BASE}/api/appointments/${appointmentId}/checkin`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return r.data
}

export async function apiMarkReady(token: string, appointmentId: number) {
  const r = await axios.post(`${BASE}/api/appointments/${appointmentId}/ready`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return r.data
}

export async function apiGetIntake(appointmentId: number) {
  const r = await api.get(`/intake/${appointmentId}`)
  return r.data
}

// ─── Provider Encounter ───────────────────────────────────────────────────────

export async function apiGetEncounter(appointmentId: string) {
  const r = await api.get(`/encounter/${appointmentId}`)
  return r.data
}

export async function apiSaveOrders(appointmentId: number, orders: { orderName: string; orderCode?: string; orderType?: string }[]) {
  const r = await api.post('/orders', { appointmentId, orders })
  return r.data
}

export async function apiGetOrders(appointmentId: number) {
  const r = await api.get(`/orders/${appointmentId}`)
  return r.data
}

export async function apiSignNote(appointmentId: string, data: Record<string, unknown>) {
  const r = await api.post(`/encounter/${appointmentId}/sign`, data)
  return r.data
}

export default api
