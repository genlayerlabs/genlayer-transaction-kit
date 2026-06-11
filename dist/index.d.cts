import { FeesDistributionInput, FeesDistribution, GenLayerChain } from 'genlayer-js/types';
export { FeesDistribution, FeesDistributionInput, GenLayerChain } from 'genlayer-js/types';

type FeePreset = 'low' | 'standard' | 'high';
type PolicyInput = {
    preset?: FeePreset;
    overrides?: Partial<FeesDistributionInput>;
    userValue?: bigint;
};
/** Allocation params measured offline (e.g. from the contract's test suite,
 *  with headroom already applied). Values may be decimal strings so a JSON
 *  fee profile can be passed through unchanged. */
type SuggestedFees = {
    leaderTimeunitsAllocation?: bigint | number | string;
    validatorTimeunitsAllocation?: bigint | number | string;
    executionBudgetPerRound?: bigint | number | string;
    totalMessageFees?: bigint | number | string;
    /** Rotations budgeted per leader round. Empirical per application — set it
     *  in the fee profile, not in user-facing UI. Defaults to 0. */
    rotationsPerRound?: bigint | number | string;
};
type FeeSuggestions = {
    version?: number;
    network?: string;
    measuredAt?: string;
    deploy?: SuggestedFees;
    methods?: Record<string, SuggestedFees>;
};
type PolicyQuote = {
    distribution: FeesDistribution;
    feeValue: bigint;
    userValue: bigint;
    total: bigint;
    /** Where the allocation params came from: a developer fee profile
     *  (measured in tests) or the network-wide defaults. Prices and caps are
     *  always live reads either way. */
    source: 'developer' | 'network-default';
    /** Pending-queue depth for the target account at estimate time, read from
     *  the consensus Queues contract via the RPC passthrough. Absent when the
     *  chain config lacks the consensus contract or the read fails. */
    queue?: {
        pendingAhead: number;
    };
    /** True when the network's fee accounting is disabled (all prices zero —
     *  e.g. a gasless Studio). No deposit is taken and submit omits fees. */
    gasless?: boolean;
    breakdown: {
        timeUnitFees: bigint;
        executionBudget: bigint;
        messageFees: bigint;
    };
    caps: {
        genPerTimeUnit: bigint;
        storagePrice: bigint;
        receiptPrice: bigint;
    };
    refundable: true;
};
type SubmitInput = {
    kind: 'deploy';
    code: string;
    args?: unknown[];
    leaderOnly?: boolean;
} | {
    kind: 'write';
    address: `0x${string}`;
    method: string;
    args?: unknown[];
};
type TrackedStatus = {
    phase: 'submitted' | 'pending' | 'processing' | 'decided' | 'finalized';
    statusName?: string;
    executionResultName?: string;
    successful?: boolean;
    genlayerTxId?: `0x${string}`;
    evmTxHash?: `0x${string}`;
    contractAddress?: `0x${string}`;
    /** Position in the pending queue while the network hasn't activated the
     *  transaction yet (0 = next up). Absent once processing starts. */
    queuePosition?: number;
};
type TransactionKit = {
    estimate(input: PolicyInput, tx?: SubmitInput): Promise<PolicyQuote>;
    submit(quote: PolicyQuote, tx: SubmitInput): Promise<{
        genlayerTxId: `0x${string}`;
        evmTxHash?: `0x${string}`;
    }>;
    track(genlayerTxId: `0x${string}`, onUpdate: (s: TrackedStatus) => void, opts?: {
        until?: 'decided' | 'finalized';
    }): Promise<TrackedStatus>;
    verification(quote: PolicyQuote, tx: SubmitInput): {
        feeConfigHash: `0x${string}`;
        summary: Record<string, string>;
    };
};
type Eip1193Provider = {
    request(args: {
        method: string;
        params?: unknown[];
    }): Promise<unknown>;
};
declare function createTransactionKit(opts: {
    chain: GenLayerChain;
    provider: Eip1193Provider;
    account?: `0x${string}`;
    /** Developer fee profile (allocations measured by the contract's test
     *  suite). When a suggestion matches the transaction, it seeds the
     *  estimate; the panel never simulates the call live. */
    suggestions?: FeeSuggestions;
}): TransactionKit;

export { type Eip1193Provider, type FeePreset, type FeeSuggestions, type PolicyInput, type PolicyQuote, type SubmitInput, type SuggestedFees, type TrackedStatus, type TransactionKit, createTransactionKit };
