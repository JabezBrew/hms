import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PatientIdentityHero from '../PatientIdentityHero'

const basePatient = {
  local_data: {
    medical_record_number: 'MRN-001',
    allergies: ['Penicillin'],
    user_details: {
      first_name: 'Ama',
      last_name: 'Mensah',
      date_of_birth: '1990-01-01',
      gender: 'female',
      phone_number: '+233555000111',
    },
  },
}

function renderHero(props = {}) {
  return render(
    <PatientIdentityHero
      patient={basePatient}
      onAddNote={vi.fn()}
      onRecordVitals={vi.fn()}
      onPrescribe={vi.fn()}
      {...props}
    />
  )
}

describe('PatientIdentityHero', () => {
  it('renders Trends as a quick action and triggers the callback', async () => {
    const user = userEvent.setup()
    const onViewTrends = vi.fn()

    renderHero({ onViewTrends })

    await user.click(screen.getByRole('button', { name: /trends/i }))

    expect(onViewTrends).toHaveBeenCalledTimes(1)
  })

  it('renders Ask Chronicle as a quick action and triggers the callback', async () => {
    const user = userEvent.setup()
    const onAskChronicle = vi.fn()

    renderHero({ onAskChronicle })

    await user.click(screen.getByRole('button', { name: /ask chronicle/i }))

    expect(onAskChronicle).toHaveBeenCalledTimes(1)
  })

  it('prefetches copilot resources when the Ask Chronicle action receives pointer intent', async () => {
    const user = userEvent.setup()
    const onActionIntent = vi.fn()

    renderHero({
      onAskChronicle: vi.fn(),
      onActionIntent,
    })

    await user.hover(screen.getByRole('button', { name: /ask chronicle/i }))

    expect(onActionIntent).toHaveBeenCalledWith('copilot')
  })
})
