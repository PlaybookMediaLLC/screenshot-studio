import { useId } from 'react'
import type { AutomationGraph, AutomationLayout } from '@/lib/api/contracts/release-automation'
import { nodeLabel, conditionSummary } from './workflow-canvas'

/** A read-only diagram of the same graph that the template saves. */
export function WorkflowTemplatePreview({
  graph,
  layout,
  name,
}: {
  graph: AutomationGraph
  layout: AutomationLayout
  name: string
}) {
  const arrow = useId()
  const positions = graph.nodes.map((node) => ({
    node,
    x: 16 + (layout[node.id]?.x ?? 0) * 0.7,
    y: 16 + (layout[node.id]?.y ?? 0) * 0.55,
  }))
  const width = Math.max(...positions.map((p) => p.x)) + 216
  const height = Math.max(...positions.map((p) => p.y)) + 58
  return (
    <svg
      role="img"
      aria-label={`${name} workflow preview`}
      viewBox={`0 0 ${width} ${height}`}
      className="size-full h-72 rounded-lg bg-muted/40 p-3 text-foreground"
    >
      <title>{name}</title>
      <desc>
        {graph.nodes.map((node) => nodeLabel(node, graph.family)).join(' → ')}. Unmatched events are
        skipped. Nothing runs in this preview.
      </desc>
      <defs>
        <marker
          id={arrow}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {graph.edges.map((edge) => {
        const from = positions.find((p) => p.node.id === edge.from)
        const to = positions.find((p) => p.node.id === edge.to)
        if (!from || !to) return null
        const x1 = from.x + 100,
          y1 = from.y + 42,
          x2 = to.x + 100,
          y2 = to.y
        return (
          <g key={`${edge.from}-${edge.to}-${edge.branch}`} className="text-muted-foreground">
            <path
              d={`M${x1} ${y1} V${(y1 + y2) / 2} H${x2} V${y2 - 3}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              markerEnd={`url(#${arrow})`}
            />
            {edge.branch !== 'next' ? (
              <text
                x={edge.branch === 'false' ? (x1 + x2) / 2 : x1 + 8}
                y={y1 + 14}
                fontSize="10"
                fill="currentColor"
              >
                {edge.branch === 'true' ? 'Yes' : 'No'}
              </text>
            ) : null}
          </g>
        )
      })}
      {positions.map(({ node, x, y }) => (
        <g key={node.id}>
          <rect x={x} y={y} width="200" height="42" rx="8" className="fill-card stroke-border" />
          <rect
            x={x}
            y={y + 10}
            width="3"
            height="22"
            rx="1.5"
            className={
              node.type === 'trigger'
                ? 'fill-emerald-500'
                : node.type === 'condition' || node.type === 'classify'
                  ? 'fill-amber-500'
                  : 'fill-muted-foreground'
            }
          />
          <text x={x + 12} y={y + 25} fontSize="12" fill="currentColor">
            {nodeLabel(node, graph.family)}
          </text>
          <title>
            {node.type === 'condition'
              ? conditionSummary(node.condition)
              : nodeLabel(node, graph.family)}
          </title>
        </g>
      ))}
    </svg>
  )
}
