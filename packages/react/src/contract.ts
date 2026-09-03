/**
 * Structural contract for @genlayer/transaction-kit (core).
 *
 * The adapters are deliberately decoupled from the core package: the dapp
 * constructs the kit with `createTransactionKit(...)` from
 * `@genlayer/transaction-kit` and passes the instance in as a prop. These
 * types mirror the core's public API structurally — TypeScript checks
 * compatibility at the call site, no runtime import needed.
 */

export type Hex = `0x${string}`;

export type FeePreset = 'low' | 'standard' | 'high';

export type FeesDistributionInput = {
  leaderTimeunitsAllocation: bigint;
  validatorTimeunitsAllocation: bigint;
  appealRounds: bigint;
  executionBudgetPerRound: bigint;
  totalMessageFees: bigint;
  rotations: bigint[];
  maxPriceGenPerTimeUnit: bigint;
  storageFeeMaxGasPrice: bigint;
  receiptFeeMaxGasPrice: bigint;
};

export type PolicyInput = {
  preset?: FeePreset;
  overrides?: Partial<FeesDistributionInput>;
  userValue?: bigint;
};

export type PolicyVerification = {
  status: 'verified' | 'mismatch' | 'unavailable';
  expectedHash?: Hex;
  actualHash?: Hex;
};

export type PolicyQuote = {
  distribution: FeesDistributionInput & { executionConsumed: bigint };
  feeValue: bigint;
  userValue: bigint;
  total: bigint;
  breakdown: {
    timeUnitFees: bigint;
    executionBudget: bigint;
    messageFees: bigint;
  };
  caps: { genPerTimeUnit: bigint; storagePrice: bigint; receiptPrice: bigint };
  source: 'developer' | 'network-default';
  /** Pending-queue depth for the target account at estimate time. */
  queue?: { pendingAhead: number };
  /** True when the network charges no fees (gasless Studio). */
  gasless?: boolean;
  verification: PolicyVerification;
  refundable: true;
};

export type SubmitInput =
  | { kind: 'deploy'; code: string; args?: unknown[]; leaderOnly?: boolean }
  | { kind: 'write'; address: Hex; method: string; args?: unknown[] };

export type TrackedPhase =
  | 'submitted'
  | 'pending'
  | 'processing'
  | 'decided'
  | 'finalized';

export type TrackedStatus = {
  phase: TrackedPhase;
  statusName?: string;
  executionResultName?: string;
  successful?: boolean;
  genlayerTxId?: Hex;
  evmTxHash?: Hex;
  contractAddress?: Hex;
  /** Pending-queue position (0 = next up); absent once processing starts. */
  queuePosition?: number;
};

export type CancelInput = { hash: Hex };

export type CancelResult = { transaction_hash: string; status: string };

export type TopUpInput = {
  account?: unknown;
  txId: Hex;
  distribution: FeesDistributionInput;
  value: bigint;
};

export type TransactionKit = {
  allowUnverified?: boolean;
  estimate(input: PolicyInput, tx?: SubmitInput): Promise<PolicyQuote>;
  submit(
    quote: PolicyQuote,
    tx: SubmitInput,
  ): Promise<{ genlayerTxId: Hex; evmTxHash?: Hex }>;
  cancel(args: CancelInput): Promise<CancelResult>;
  topUp(args: TopUpInput): Promise<Hex>;
  track(
    genlayerTxId: Hex,
    onUpdate: (s: TrackedStatus) => void,
    opts?: { until?: 'decided' | 'finalized' },
  ): Promise<TrackedStatus>;
  verification(
    quote: PolicyQuote,
    tx: SubmitInput,
  ): { feeConfigHash: Hex; summary: Record<string, string> };
};
