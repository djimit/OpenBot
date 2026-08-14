/** Shapes shared by the managed-VM supervisor and the modules it composes. */

import type { ComputerTarget, VmProvisionProgress } from '../../shared/types'

export type VmTarget = Extract<ComputerTarget, { kind: 'vm' }>
export type ProgressReporter = (progress: VmProvisionProgress) => void
