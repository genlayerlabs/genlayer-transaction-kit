import type {
  Hex,
  PolicyInput,
  PolicyQuote,
  SubmitInput,
  TrackedStatus,
  TransactionKit,
} from './contract';

const PRESET_APPEALS: Record<string, bigint> = { low: 1n, standard: 3n, high: 5n };
const GEN_PER_TIME_UNIT = 10n ** 15n;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asBigInt = (
  value: bigint | number | string | undefined,
  fallback: bigint,
): bigint => (value === undefined ? fallback : BigInt(value));

/**
 * Deterministic mock kit for demos and component tests. Mirrors the shapes
 * the real @genlayer/transaction-kit core produces; no network access.
 */
export function createMockKit(opts?: {
  failWith?: string;
  outcome?: { statusName: string; executionResultName: string };
  delays?: { estimate?: number; submit?: number; step?: number };
  /** Pretend a developer fee profile matched the call. */
  suggestions?: boolean;
  /** Pending-queue depth shown in the review step. */
  queueAhead?: number;
  /** Simulate a gasless network (no deposit, no fee receipt). */
  gasless?: boolean;
  verificationStatus?: PolicyQuote['verification']['status'];
  allowUnverified?: boolean;
  failCancelWith?: string;
  failTopUpWith?: string;
}): TransactionKit {
  const delays = { estimate: 350, submit: 500, step: 600, ...opts?.delays };
  return {
    ...(opts?.allowUnverified ? { allowUnverified: true } : {}),

    async estimate(input: PolicyInput): Promise<PolicyQuote> {
      await sleep(delays.estimate);
      const appeals = asBigInt(
        input.overrides?.appealRounds,
        PRESET_APPEALS[input.preset ?? 'standard'] ?? 3n,
      );
      const rotations = input.overrides?.rotations?.map((value) => BigInt(value)) ??
        Array.from({ length: Number(appeals) + 1 }, () => 0n);
      const leaderTimeunitsAllocation = asBigInt(
        input.overrides?.leaderTimeunitsAllocation,
        100n,
      );
      const validatorTimeunitsAllocation = asBigInt(
        input.overrides?.validatorTimeunitsAllocation,
        200n,
      );
      const leaderRounds = BigInt(rotations.length) + appeals;
      const timeUnits =
        (leaderTimeunitsAllocation + 5n * validatorTimeunitsAllocation) *
        (appeals * 2n + 1n);
      const timeUnitFees = timeUnits * GEN_PER_TIME_UNIT;
      const budgetPerRound = asBigInt(
        input.overrides?.executionBudgetPerRound,
        76_548_000_000_000n,
      );
      const executionBudget = budgetPerRound * leaderRounds;
      const messageFees = asBigInt(input.overrides?.totalMessageFees, 0n);
      const userValue = input.userValue ?? 0n;
      const feeValue = timeUnitFees + executionBudget + messageFees;
      const verificationStatus = opts?.verificationStatus ?? 'verified';
      const expectedHash = (`0x${'11'.repeat(32)}`) as Hex;
      const actualHash =
        verificationStatus === 'mismatch'
          ? ((`0x${'22'.repeat(32)}`) as Hex)
          : expectedHash;
      return {
        distribution: {
          leaderTimeunitsAllocation,
          validatorTimeunitsAllocation,
          appealRounds: appeals,
          executionBudgetPerRound: budgetPerRound,
          executionConsumed: 0n,
          totalMessageFees: messageFees,
          rotations,
          maxPriceGenPerTimeUnit: (GEN_PER_TIME_UNIT * 12n) / 10n,
          storageFeeMaxGasPrice: 12n,
          receiptFeeMaxGasPrice: 300_000_000n,
        },
        feeValue,
        userValue,
        total: feeValue + userValue,
        breakdown: { timeUnitFees, executionBudget, messageFees },
        caps: {
          genPerTimeUnit: (GEN_PER_TIME_UNIT * 12n) / 10n,
          storagePrice: 12n,
          receiptPrice: 300_000_000n,
        },
        source: opts?.suggestions ? ('developer' as const) : ('network-default' as const),
        ...(opts?.queueAhead !== undefined ? { queue: { pendingAhead: opts.queueAhead } } : {}),
        ...(opts?.gasless ? { gasless: true } : {}),
        verification:
          verificationStatus === 'unavailable'
            ? { status: 'unavailable', expectedHash }
            : { status: verificationStatus, expectedHash, actualHash },
        refundable: true,
      };
    },

    async submit(): Promise<{ genlayerTxId: Hex; evmTxHash?: Hex }> {
      await sleep(delays.submit);
      if (opts?.failWith) throw new Error(opts.failWith);
      return {
        genlayerTxId: ('0x' + 'ab'.repeat(32)) as Hex,
        evmTxHash: ('0x' + 'cd'.repeat(32)) as Hex,
      };
    },

    async track(genlayerTxId, onUpdate): Promise<TrackedStatus> {
      const outcome = opts?.outcome ?? {
        statusName: 'ACCEPTED',
        executionResultName: 'FINISHED_WITH_RETURN',
      };
      const steps: TrackedStatus[] = [
        { phase: 'pending', genlayerTxId, queuePosition: 2 },
        { phase: 'pending', genlayerTxId, queuePosition: 0 },
        { phase: 'processing', genlayerTxId },
        {
          phase: 'decided',
          genlayerTxId,
          statusName: outcome.statusName,
          executionResultName: outcome.executionResultName,
          successful:
            ['ACCEPTED', 'FINALIZED'].includes(outcome.statusName.toUpperCase()) &&
            outcome.executionResultName.toUpperCase() === 'FINISHED_WITH_RETURN',
          contractAddress: ('0x' + '12'.repeat(20)) as Hex,
        },
      ];
      let last: TrackedStatus = { phase: 'submitted', genlayerTxId };
      for (const step of steps) {
        await sleep(delays.step);
        last = step;
        onUpdate(step);
      }
      return last;
    },

    async cancel() {
      await sleep(delays.submit);
      if (opts?.failCancelWith) throw new Error(opts.failCancelWith);
      return {
        transaction_hash: ('0x' + 'ab'.repeat(32)) as Hex,
        status: 'CANCELED',
      };
    },

    async topUp() {
      await sleep(delays.submit);
      if (opts?.failTopUpWith) throw new Error(opts.failTopUpWith);
      return ('0x' + 'ef'.repeat(32)) as Hex;
    },

    verification(quote: PolicyQuote, tx: SubmitInput) {
      const fingerprint = [
        quote.feeValue,
        quote.distribution.appealRounds,
        quote.distribution.executionBudgetPerRound,
        tx.kind,
      ].join('|');
      let hash = 0n;
      for (const char of fingerprint) hash = (hash * 31n + BigInt(char.charCodeAt(0))) % 2n ** 160n;
      return {
        feeConfigHash:
          quote.verification?.expectedHash ??
          ((`0x${hash.toString(16).padStart(64, '0')}`) as Hex),
        summary: { total: quote.total.toString(), kind: tx.kind },
      };
    },
  };
}
