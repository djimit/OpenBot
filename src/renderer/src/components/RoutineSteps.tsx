import type { ReactNode } from 'react'
import type { RoutineStep } from '../../../shared/types'
import { pngSrc, summarizeArgs } from '../lib/format'
import './RoutineSteps.css'

interface RoutineStepsProps {
  steps: RoutineStep[]
  emptyText: string
}

/** Ordered capture of what a routine does, one row per step. */
export function RoutineSteps({ steps, emptyText }: RoutineStepsProps): ReactNode {
  if (steps.length === 0) return <p className="ob-hint">{emptyText}</p>

  return (
    <ol className="ob-steps">
      {steps.map((step, i) => {
        const params = step.params ? summarizeArgs(step.kind, step.params) : ''
        return (
          <li key={step.id} className="ob-step">
            <span className="ob-step-index">{i + 1}</span>
            {step.reference ? (
              <img className="ob-step-thumb" src={pngSrc(step.reference)} alt={`Reference capture for step ${i + 1}`} />
            ) : null}
            <span className="ob-step-body">
              <span className="ob-step-head">
                <span className="ob-pill">{step.kind}</span>
                {params ? <span className="ob-step-params">{params}</span> : null}
              </span>
              <span className="ob-step-intent">{step.intent || 'No description captured.'}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
