export interface Provider {
  id: number
  name: string
  email: string
  specialty: string
}

export interface DashboardMetrics {
  todayRevenue: number
  claimsNeedingAction: number
  outstandingAR: number
  cleanClaimRate: number
}

export interface Appointment {
  id: number
  patientName: string
  time: string | null
  visitType: string
  eligibilityStatus: string | null
  copay: number | null
}

export interface ActionItem {
  id: number
  priority: number
  title: string
  description: string | null
  aiInstruction: string | null
  sourceAgent: string
  createdAt: string
}

export interface CredentialAlert {
  type: string
  daysRemaining: number
  expiryDate: string
  priority: number
}

export interface PayerPattern {
  payer: string
  denialRate: number
  topCode: string | null
  message: string
}

export interface Sparklines {
  revenue: number[]
  claimsAction: number[]
  cleanClaimRate: number[]
}

export interface DashboardData {
  provider: Provider
  metrics: DashboardMetrics
  sparklines?: Sparklines
  todayAppointments: Appointment[]
  actionItems: ActionItem[]
  credentialAlerts: CredentialAlert[]
  payerPatterns: PayerPattern[]
}

export interface Claim {
  id: number
  claimId: string
  patientName: string
  dateOfService: string
  procedureCode: string | null
  billedAmount: number
  paidAmount: number
  status: string
  denialCode: string | null
  denialPlain: string | null
  aiInstruction: string | null
  priority: number
}

export interface ClaimsData {
  total: number
  revenueAtRisk: number
  claims: Claim[]
}

export interface Credential {
  id: number
  credentialType: string
  identifier: string | null
  issuingBody: string | null
  state: string | null
  expiryDate: string | null
  status: string
  renewalUrl: string | null
  daysRemaining: number | null
}

export interface PayerEnrollment {
  id: number
  payerCode: string
  payerName: string
  status: string
  effectiveDate: string | null
  expiryDate: string | null
}

export interface CredentialsData {
  credentials: Credential[]
  enrollments: PayerEnrollment[]
}

export interface RevenueByPayer {
  payer: string
  billed: number
  collected: number
}

export interface Expense {
  category: string
  amount: number
  type: 'fixed' | 'variable'
}

export interface FinancialSummary {
  revenueCollected: number
  totalBilled: number
  outstandingAR: number
  totalExpenses: number
  netIncome: number
  revenueByPayer: RevenueByPayer[]
  expenses: Expense[]
}

export interface MonthlyTrend {
  month: string
  revenue: number
  expenses: number
  net: number
  visits: number
}

export interface PayerTrend {
  months: string[]
  series: { payer: string; data: number[] }[]
}

export interface DenialTrend {
  trend: { month: string; total: number; denied: number; denialRate: number }[]
  topCodes: { code: string; description: string | null; count: number }[]
}

export interface AppointmentDetail {
  id: number
  patientId: number
  patientName: string
  dob: string | null
  payerName: string | null
  payerCode: string | null
  memberId: string | null
  copay: number | null
  deductibleRemaining: number | null
  visitType: string
  date: string
  eligibilityStatus: string | null
  eligibilitySummary: string | null
}
