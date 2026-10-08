import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ok = (value: unknown) => ({ value }) as never

function world(on: On, surfaces: string[]) {
  mock.clock(on, { now: Date.parse('2026-10-08T12:00:00Z') })
  mock.env(on, { USERPROFILE: 'C:\\Users\\Hasan' })
  const status: (string | undefined)[] = []
  on('fs.read', async () => ok(JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' } })))
  on('session.usage', async () =>
    ok({
      startedAt: 0,
      context: { tokens: 410000, window: 1000000, percent: 41 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 45, resetsAt: '2026-10-08T15:13:00Z' },
        { kind: 'seven_day', percentUsed: 7, resetsAt: '2026-10-15T03:00:00Z' },
      ],
    }),
  )
  on('session.model', async () => ok('claude-opus-5-5[1m]'))
  on('session.surfaces', async () => ok(surfaces))
  on('ui.status', async ($, e) => {
    status.push(e.text)
    return ok(undefined)
  })
  on('ui.invalidate', async () => ok(undefined))
  on('session.start', async () => ({ cwd: 'C:\\repo' }) as never)
  return status
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: the toolbar draws the meters, so the footer line is cleared`, async ($, on) => {
    const status = world(on, [surface])
    await $.session.start({ source: 'startup', cwd: 'C:\\repo', surface, isInteractive: true } as never)
    expect(status.at(-1)).toBeUndefined()
  })
}

test('no surface at all: the footer line carries the figures', async ($, on) => {
  const status = world(on, [])
  await $.session.start({ source: 'startup', cwd: 'C:\\repo', surface: 'terminal', isInteractive: true } as never)
  expect(status.at(-1)).toContain('5h 🟢 ▰▰▰▰▰▱▱▱▱▱ 45% ↻3h13m')
  expect(status.at(-1)).toContain('[work] me@example.com')
})
