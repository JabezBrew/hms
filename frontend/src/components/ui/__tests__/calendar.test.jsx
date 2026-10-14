import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { CalendarImpl } from '../calendar-impl'
import { AvailabilityCalendarPanel } from '@/features/appointments/components/doctor-availability-calendar/AvailabilityCalendarPanel'

function AvailabilityFixture() {
  const [month, setMonth] = useState(new Date(new Date().getFullYear(), 11, 1))
  return (
    <AvailabilityCalendarPanel
      availableDates={[]}
      unavailableDates={[]}
      currentMonth={month}
      setCurrentMonth={setMonth}
      handleSelect={() => {}}
      isLoading={false}
    />
  )
}

describe('Calendar navigation', () => {
  it('offers one named month-navigation pair and advances availability into the next year', async () => {
    const user = userEvent.setup()
    render(<AvailabilityFixture />)

    const next = await screen.findByRole('button', { name: 'Next month' })
    expect(screen.getAllByRole('button', { name: 'Next month' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Previous month' })).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('December')

    await user.click(next)

    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('January')
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveTextContent(String(new Date().getFullYear() + 1))
  })

  it('includes a future displayed year in its year choices', async () => {
    const user = userEvent.setup()
    const futureYear = new Date().getFullYear() + 20
    render(<CalendarImpl defaultMonth={new Date(futureYear, 0, 1)} />)

    screen.getByRole('combobox', { name: 'Year' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('option', { name: String(futureYear), exact: true })).toBeInTheDocument()
  })

  it('respects explicit date-picker year boundaries', async () => {
    const user = userEvent.setup()
    render(<CalendarImpl defaultMonth={new Date(2020, 11, 1)} fromYear={2019} toYear={2020} />)

    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    screen.getByRole('combobox', { name: 'Year' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('option', { name: '2019', exact: true })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2020', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2021', exact: true })).not.toBeInTheDocument()
  })
})
