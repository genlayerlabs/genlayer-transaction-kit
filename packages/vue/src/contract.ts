/**
 * Public core types consumed by the Vue adapter.
 *
 * Keeping these as type-only re-exports preserves a zero-runtime-dependency
 * adapter while making the compiler enforce compatibility with the exact core
 * package version declared as a peer dependency.
 */
export type {
  CancelInput,
  CancelResult,
  FeePreset,
  FeesDistributionInput,
  PolicyInput,
  PolicyQuote,
  PolicyVerification,
  SubmitInput,
  TopUpInput,
  TrackedStatus,
  TransactionKit,
} from '@genlayer/transaction-kit';

import type { TrackedStatus } from '@genlayer/transaction-kit';

export type Hex = `0x${string}`;
export type TrackedPhase = TrackedStatus['phase'];
