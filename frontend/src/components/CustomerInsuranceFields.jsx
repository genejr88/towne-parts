import { User, Shield } from 'lucide-react'
import Input from '@/components/ui/Input'

/**
 * Unified customer + insurance fields used across CreateRO, EditRO, and the
 * Production Board's customer drawer. Keep field NAMES identical to the RO
 * model on the backend (ownerName, ownerPhone, ownerPhone2, ownerEmail,
 * insuranceCompany, claimNumber, policyNumber, adjusterName, adjusterPhone,
 * deductible, dateOfLoss).
 *
 * Props:
 *  - form: object with the fields above
 *  - onChange: (field, value) => void
 *  - showHeaders: render section headers (true on EditRO; can hide on CreateRO)
 *  - density: 'compact' | 'normal' — compact tightens spacing for drawers
 */
export default function CustomerInsuranceFields({ form, onChange, showHeaders = true, density = 'normal' }) {
  const gap = density === 'compact' ? 'gap-2.5' : 'gap-3'
  const set = (field) => (e) => onChange(field, e.target.value)

  return (
    <div className={`flex flex-col ${gap}`}>
      {showHeaders && (
        <div className="flex items-center gap-2 pt-1 pb-1 border-b border-gray-700/50">
          <User size={14} className="text-gray-400" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Customer / Owner</p>
        </div>
      )}

      <Input
        label="Owner Name"
        value={form.ownerName || ''}
        onChange={set('ownerName')}
        placeholder="Jane Smith"
      />

      <div className={`grid grid-cols-2 ${gap}`}>
        <Input
          label="Phone"
          type="tel"
          value={form.ownerPhone || ''}
          onChange={set('ownerPhone')}
          placeholder="(860) 555-0100"
        />
        <Input
          label="Alt Phone"
          type="tel"
          value={form.ownerPhone2 || ''}
          onChange={set('ownerPhone2')}
          placeholder="(860) 555-0101"
        />
      </div>

      <Input
        label="Email"
        type="email"
        value={form.ownerEmail || ''}
        onChange={set('ownerEmail')}
        placeholder="jane@email.com"
      />

      {showHeaders && (
        <div className="flex items-center gap-2 pt-2 pb-1 border-b border-gray-700/50">
          <Shield size={14} className="text-gray-400" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Insurance</p>
        </div>
      )}

      <Input
        label="Insurance Company"
        value={form.insuranceCompany || ''}
        onChange={set('insuranceCompany')}
        placeholder="State Farm"
      />

      <div className={`grid grid-cols-2 ${gap}`}>
        <Input
          label="Claim Number"
          value={form.claimNumber || ''}
          onChange={set('claimNumber')}
          placeholder="CLM-00123"
        />
        <Input
          label="Policy Number"
          value={form.policyNumber || ''}
          onChange={set('policyNumber')}
          placeholder="POL-456"
        />
      </div>

      <div className={`grid grid-cols-2 ${gap}`}>
        <Input
          label="Adjuster Name"
          value={form.adjusterName || ''}
          onChange={set('adjusterName')}
          placeholder="John Adjuster"
        />
        <Input
          label="Adjuster Phone"
          type="tel"
          value={form.adjusterPhone || ''}
          onChange={set('adjusterPhone')}
          placeholder="(860) 555-0200"
        />
      </div>

      <div className={`grid grid-cols-2 ${gap}`}>
        <Input
          label="Deductible ($)"
          type="number"
          value={form.deductible || ''}
          onChange={set('deductible')}
          placeholder="500"
          step="0.01"
        />
        <Input
          label="Date of Loss"
          type="date"
          value={form.dateOfLoss || ''}
          onChange={set('dateOfLoss')}
        />
      </div>
    </div>
  )
}
