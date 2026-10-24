'use client'

import * as React from 'react'
import type { AnalyticsReport } from '@/lib/api/contracts/plan-analyze'
import { formatValue } from '@/lib/analyze/report'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Values are lifetime engagement per published post, grouped by local publication hour. */
export function Hourly({
  report,
  onInspect,
}: {
  report: AnalyticsReport
  onInspect: (ids: string[], label: string) => void
}) {
  const [mode, setMode] = React.useState('average')
  const [day, setDay] = React.useState(1)
  const cells = report.hourly
  const samples = cells.reduce((n, cell) => n + cell.samples, 0)
  const averages = Array.from({ length: 24 }, (_, hour) => {
    const selected = cells.filter((c) => c.hour === hour && (mode === 'average' || c.day === day))
    const count = selected.reduce((n, c) => n + c.samples, 0),
      total = selected.reduce((n, c) => n + c.total, 0)
    return {
      hour,
      samples: count,
      average: count ? total / count : null,
      postIds: selected.flatMap((c) => c.postIds),
    }
  })
  const maximum = Math.max(
    1,
    ...cells.map((c) => c.average ?? 0),
    ...averages.map((c) => c.average ?? 0)
  )
  return (
    <section aria-label="Hourly Engagement" className="rounded-xl border p-4">
      <h2 className="font-semibold">Hourly Engagement</h2>
      <p className="my-2 text-xs text-muted-foreground">
        Average observed lifetime engagements per post, by publication time in{' '}
        {report.query.timeZone}. This does not measure when engagement occurred. {samples} posts
        with observations; small samples do not establish a best posting time.
      </p>
      <div className="my-3 flex gap-2">
        <label>
          View{' '}
          <select aria-label="Hourly mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="average">Average</option>
            <option value="days">Days</option>
            <option value="heatmap">Heatmap</option>
          </select>
        </label>
        {mode === 'days' ? (
          <label>
            Day{' '}
            <select
              aria-label="Weekday"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              {DAYS.map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {!samples ? (
        <p role="status">
          Insufficient engagement history. Collect post observations to explore publishing times.
        </p>
      ) : null}
      {mode === 'heatmap' ? (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <caption className="sr-only">
              Seven weekdays by 24 hours, average engagement and sample counts
            </caption>
            <thead>
              <tr>
                <th>Day</th>
                {Array.from({ length: 24 }, (_, i) => (
                  <th key={i}>{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((label, day) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const c = cells.find((v) => v.day === day && v.hour === hour)
                    return (
                      <td key={hour}>
                        <button
                          disabled={!c?.samples}
                          onClick={() =>
                            onInspect(c!.postIds, `${label} ${hour}:00 · ${report.query.timeZone}`)
                          }
                          title={`${label} ${hour}:00: ${formatValue(c?.average)} average, ${c?.samples ?? 0} posts`}
                          aria-label={`${label} ${hour}:00, ${formatValue(c?.average)} average, ${c?.samples ?? 0} posts`}
                          className="m-0.5 h-8 w-8 rounded border"
                          style={{
                            backgroundColor:
                              c?.average == null
                                ? undefined
                                : `rgba(14,165,233,${0.12 + (c.average / maximum) * 0.8})`,
                          }}
                        >
                          {c?.samples ? formatValue(c.average, true) : '—'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {averages.map((c) => (
            <button
              key={c.hour}
              disabled={!c.samples}
              onClick={() =>
                onInspect(
                  c.postIds,
                  `${mode === 'days' ? DAYS[day] : 'All days'} ${c.hour}:00 · ${report.query.timeZone}`
                )
              }
              className="rounded border p-2 text-xs"
              title={`${c.samples} posts`}
            >
              <span className="block">{c.hour}:00</span>
              <strong>{formatValue(c.average, true)}</strong>
              <span className="block text-muted-foreground">n={c.samples}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
