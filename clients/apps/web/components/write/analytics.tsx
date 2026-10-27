'use client'

import { useMemo, useState } from 'react'
import type { SocialObservation, BackendBestTime } from 'screenshot-studio-backend-sdk'
import { Button } from '@/components/ui/button'
import { AccountMetricCharts } from './account-metric-charts'
import { BestPostingTimes } from './best-posting-times'
import {
  accountObservationBuckets,
  analyticsCSV,
  latestObservations,
  observationBuckets,
} from '@/lib/write/analytics'

/** Stored observations with explicit unavailable states and accessible chart data. */
export function SocialAnalytics({
  observations,
  recommendations = [],
  timeZone = 'UTC',
  canManage = false,
  range,
  rangeError,
  socialSetId,
}: {
  observations: SocialObservation[]
  recommendations?: BackendBestTime[]
  timeZone?: string
  canManage?: boolean
  range: { start: string; end: string }
  rangeError?: string
  socialSetId?: string
}) {
  const [channel, setChannel] = useState('all')
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [metric, setMetric] = useState('likes')
  const rows = useMemo(
    () => observations.filter((row) => channel === 'all' || row.platform === channel),
    [observations, channel]
  )
  const latest = latestObservations(rows)
  const posts = latest
    .filter((row) => row.kind === 'post')
    .sort((a, b) => (b.metrics[metric] ?? -1) - (a.metrics[metric] ?? -1))
  const buckets = observationBuckets(rows, period, metric)
  const accountBuckets = accountObservationBuckets(rows, period)
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.value ?? 0))
  const metrics = [...new Set(['likes', ...rows.flatMap((row) => Object.keys(row.metrics))])]
  const exportCSV = () => {
    const url = URL.createObjectURL(
      new Blob([analyticsCSV(rows)], { type: 'text/csv;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'social-observations.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section
      className="mx-auto grid w-full max-w-5xl gap-6 overflow-auto p-6"
      data-testid="social-analytics"
    >
      <div>
        <h1 className="text-2xl font-semibold">Social analytics</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Provider observations from {range.start} to {range.end} (UTC). Post metrics are cumulative
          snapshots, not engagement earned during each period. New posts are collected daily for 30
          days.
        </p>
      </div>
      {socialSetId && recommendations.length > 0 && (
        <BestPostingTimes
          items={recommendations}
          setId={socialSetId}
          timeZone={timeZone}
          canManage={canManage}
        />
      )}
      <form className="flex flex-wrap items-end gap-3" method="get">
        {socialSetId ? <input type="hidden" name="set" value={socialSetId} /> : null}
        <label>
          From{' '}
          <input
            aria-label="Analytics from"
            name="from"
            type="date"
            defaultValue={range.start}
            required
            className="rounded border bg-background p-2"
          />
        </label>
        <label>
          Through{' '}
          <input
            aria-label="Analytics through"
            name="to"
            type="date"
            defaultValue={range.end}
            required
            className="rounded border bg-background p-2"
          />
        </label>
        <Button variant="outline" type="submit">
          Apply dates
        </Button>
      </form>
      {rangeError ? <p role="alert">{rangeError}</p> : null}
      <div className="flex flex-wrap gap-3">
        <label>
          Channel{' '}
          <select
            aria-label="Channel"
            className="rounded border bg-background p-2"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="all">All channels</option>
            {[...new Set(observations.map((row) => row.platform))].map((platform) => (
              <option key={platform}>{platform}</option>
            ))}
          </select>
        </label>
        <label>
          Period{' '}
          <select
            aria-label="Period"
            className="rounded border bg-background p-2"
            value={period}
            onChange={(event) => setPeriod(event.target.value as 'week' | 'month')}
          >
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>
        <label>
          Metric{' '}
          <select
            aria-label="Metric"
            className="rounded border bg-background p-2"
            value={metric}
            onChange={(event) => setMetric(event.target.value)}
          >
            {metrics.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <Button variant="outline" disabled={!rows.length} onClick={exportCSV}>
          Export CSV
        </Button>
      </div>
      {!rows.length ? (
        <p>
          No provider observations yet. Connect a supported account and wait for the daily
          collection. Unsupported metrics will appear as unavailable.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {['likes', 'impressions', 'replies'].map((name) => {
              const known = posts.filter(
                (row) => row.status === 'available' && row.metrics[name] !== undefined
              )
              return (
                <div className="rounded border p-4" key={name}>
                  <p className="text-sm">Observed {name}</p>
                  <p className="text-2xl">
                    {known.length
                      ? known.reduce((sum, row) => sum + row.metrics[name], 0).toLocaleString()
                      : 'Unavailable'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {known.length} posts with this metric
                  </p>
                </div>
              )
            })}
          </div>
          {buckets.length > 0 && (
            <figure>
              <figcaption className="mb-3">
                Latest cumulative {metric} per post in each {period} (UTC)
              </figcaption>
              <svg
                role="img"
                aria-label={`${metric} snapshots; exact values in the following table`}
                viewBox="0 0 600 180"
                className="h-44 w-full"
              >
                {buckets.map((bucket, index) =>
                  bucket.value === null ? null : (
                    <rect
                      key={bucket.date}
                      fill="currentColor"
                      className="text-sky-700 dark:text-sky-400"
                      x={(index * 600) / buckets.length + 2}
                      y={160 - (bucket.value / maximum) * 150}
                      width={Math.max(1, 600 / buckets.length - 4)}
                      height={Math.max(1, (bucket.value / maximum) * 150)}
                    >
                      <title>{`${bucket.date}: ${bucket.value}`}</title>
                    </rect>
                  )
                )}
              </svg>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Period starts</th>
                    <th>{metric}</th>
                    <th>Reporting posts</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr key={bucket.date}>
                      <td>{bucket.date}</td>
                      <td>{bucket.value ?? 'Unavailable'}</td>
                      <td>{bucket.posts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </figure>
          )}
          <div className="overflow-x-auto">
            <h2 className="mb-2 font-medium">Posts by {metric}</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Channel</th>
                  <th>{metric}</th>
                  <th>Observed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((row) => (
                  <tr className="border-t" key={row.id}>
                    <td className="max-w-40 truncate py-2">
                      {row.draftId ? (
                        <a className="underline" href={`/write/${row.draftId}`}>
                          {row.title || row.caption || row.subjectId}
                        </a>
                      ) : row.url ? (
                        <a
                          className="underline"
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.caption || row.title || row.subjectId}
                        </a>
                      ) : (
                        row.subjectId
                      )}
                    </td>
                    <td>{row.platform}</td>
                    <td>
                      {row.status === 'available'
                        ? (row.metrics[metric] ?? 'Unavailable')
                        : 'Unavailable'}
                    </td>
                    <td>
                      {new Date(row.observedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
                    </td>
                    <td>{row.status === 'failed' ? 'Read failed; retry pending' : row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="font-medium">Account metrics</h2>
            <p className="text-xs text-muted-foreground">
              Last reported value in each {period}. Provider totals, follower counts and overlapping
              reporting windows are not added together. Definitions differ between channels.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Profile-to-follower conversion is unavailable: these observations do not attribute new
              followers to profile visits. Missing periods are not plotted as zero.
            </p>
            <AccountMetricCharts buckets={accountBuckets} />
            {accountBuckets.length ? (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Account</th>
                    <th>Metric</th>
                    <th>Period</th>
                    <th>As of</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {accountBuckets.map((bucket) => (
                    <tr key={`${bucket.connection}:${bucket.metric}:${bucket.period}`}>
                      <td>{bucket.platform}</td>
                      <td className="max-w-40 break-words">{bucket.connection}</td>
                      <td>{bucket.metric}</td>
                      <td>{bucket.period}</td>
                      <td>{bucket.date}</td>
                      <td>{bucket.value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {latest
              .filter((row) => row.kind === 'account' || row.kind === 'feed')
              .map((row) => (
                <details className="mt-3 rounded border p-3" key={row.id}>
                  <summary>
                    {row.platform} · {row.connectionId} ·{' '}
                    {row.kind === 'feed'
                      ? 'Recent provider posts (up to 100 originals, 30 days)'
                      : 'Account metrics'}{' '}
                    · {row.status}
                  </summary>
                  {row.series.map((series) => (
                    <div key={series.label}>
                      <h3 className="mt-2 font-medium">
                        {series.label}
                        {series.average ? ' (provider average)' : ''}
                      </h3>
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {series.data.map((point, index) => (
                            <tr key={index}>
                              <td>{point.date}</td>
                              <td>{point.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </details>
              ))}
          </div>
        </>
      )}
    </section>
  )
}
