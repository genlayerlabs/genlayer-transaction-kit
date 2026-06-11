import React from 'react';

/**
 * Structural contract for @genlayer/transaction-kit (core).
 *
 * The adapters are deliberately decoupled from the core package: the dapp
 * constructs the kit with `createTransactionKit(...)` from
 * `@genlayer/transaction-kit` and passes the instance in as a prop. These
 * types mirror the core's public API structurally — TypeScript checks
 * compatibility at the call site, no runtime import needed.
 */
type Hex = `0x${string}`;
type FeePreset = 'low' | 'standard' | 'high';
type FeesDistributionInput = {
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
type PolicyInput = {
    preset?: FeePreset;
    overrides?: Partial<FeesDistributionInput>;
    userValue?: bigint;
};
type PolicyQuote = {
    distribution: FeesDistributionInput & {
        executionConsumed: bigint;
    };
    feeValue: bigint;
    userValue: bigint;
    total: bigint;
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
    source: 'developer' | 'network-default';
    /** Pending-queue depth for the target account at estimate time. */
    queue?: {
        pendingAhead: number;
    };
    /** True when the network charges no fees (gasless Studio). */
    gasless?: boolean;
    refundable: true;
};
type SubmitInput = {
    kind: 'deploy';
    code: string;
    args?: unknown[];
    leaderOnly?: boolean;
} | {
    kind: 'write';
    address: Hex;
    method: string;
    args?: unknown[];
};
type TrackedPhase = 'submitted' | 'pending' | 'processing' | 'decided' | 'finalized';
type TrackedStatus = {
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
type TransactionKit = {
    estimate(input: PolicyInput, tx?: SubmitInput): Promise<PolicyQuote>;
    submit(quote: PolicyQuote, tx: SubmitInput): Promise<{
        genlayerTxId: Hex;
        evmTxHash?: Hex;
    }>;
    track(genlayerTxId: Hex, onUpdate: (s: TrackedStatus) => void, opts?: {
        until?: 'decided' | 'finalized';
    }): Promise<TrackedStatus>;
    verification(quote: PolicyQuote, tx: SubmitInput): {
        feeConfigHash: Hex;
        summary: Record<string, string>;
    };
};

/** Split a wei amount into whole-GEN and an 18-digit fractional string. */
declare function splitGen(wei: bigint): {
    whole: string;
    fraction: string;
};
/**
 * Human GEN amount: at least 4 significant fractional digits, anchored at the
 * first non-zero digit for tiny values, trailing zeros trimmed.
 * 1234500000000000n → "0.0012345"
 */
declare function formatGen(wei: bigint): string;
/** Group long digit runs with thin spaces for readability: 1234567 → 1 234 567 */
declare function groupDigits(value: string): string;
declare function formatWei(wei: bigint): string;
declare function shortHash(hash: string, head?: number, tail?: number): string;
declare function describeError(raw: string): {
    title: string;
    detail: string;
    raw: string;
};
/** Outcome copy for decided-but-not-successful consensus states. */
declare function describeOutcome(statusName?: string, executionResultName?: string): {
    tone: 'success' | 'warn' | 'error';
    title: string;
    detail: string;
};

type FlowState = {
    step: 'estimating';
    preset: FeePreset;
} | {
    step: 'review';
    preset: FeePreset;
    quote: PolicyQuote;
} | {
    step: 'signing';
    preset: FeePreset;
    quote: PolicyQuote;
} | {
    step: 'tracking';
    preset: FeePreset;
    quote: PolicyQuote;
    status: TrackedStatus;
} | {
    step: 'done';
    preset: FeePreset;
    quote: PolicyQuote;
    status: TrackedStatus;
} | {
    step: 'error';
    preset: FeePreset;
    quote?: PolicyQuote;
    message: string;
};
type TransactionFlow = {
    state: FlowState;
    preset: FeePreset;
    setPreset: (p: FeePreset) => void;
    overrides: PolicyInput['overrides'];
    setOverrides: (o: PolicyInput['overrides']) => void;
    quote: PolicyQuote | undefined;
    verification: {
        feeConfigHash: string;
        summary: Record<string, string>;
    } | undefined;
    approve: () => Promise<void>;
    reset: () => void;
};
/**
 * Headless state machine for the approve-and-sign flow.
 * estimating → review → signing → tracking → done | error
 * Changing the preset or overrides re-estimates and returns to review.
 */
declare function useTransactionFlow(opts: {
    kit: TransactionKit;
    tx: SubmitInput;
    userValue?: bigint;
    trackUntil?: 'decided' | 'finalized';
}): TransactionFlow;

declare function FeeReceipt({ quote, busy }: {
    quote: PolicyQuote;
    busy?: boolean;
}): React.JSX.Element;
declare function PresetSelector(props: {
    value: FeePreset;
    onChange: (p: FeePreset) => void;
    disabled?: boolean;
}): React.JSX.Element;
declare function CapsShield({ quote }: {
    quote: PolicyQuote;
}): React.JSX.Element;
declare function VerifyBadge(props: {
    feeConfigHash?: string;
    snapState?: 'verified' | 'unavailable';
}): React.JSX.Element | null;
/** Approval button. Touch holds to confirm (no accidental taps); mouse and
 *  keyboard confirm directly — the review panel is the deliberateness step,
 *  and a long-press is alien on desktop. */
declare function HoldToSign(props: {
    onConfirm: () => void;
    disabled?: boolean;
    holdMs?: number;
    label?: string;
}): React.JSX.Element;
declare function Timeline({ status }: {
    status: TrackedStatus;
}): React.JSX.Element;
type TransactionPanelProps = {
    kit: TransactionKit;
    tx: SubmitInput;
    userValue?: bigint;
    network?: string;
    theme?: 'dark' | 'light';
    trackUntil?: 'decided' | 'finalized';
    snapState?: 'verified' | 'unavailable';
    onDone?: (status: TrackedStatus) => void;
};
declare function GenLayerTransactionPanel(props: TransactionPanelProps): React.JSX.Element;

/**
 * Deterministic mock kit for demos and component tests. Mirrors the shapes
 * the real @genlayer/transaction-kit core produces; no network access.
 */
declare function createMockKit(opts?: {
    failWith?: string;
    outcome?: {
        statusName: string;
        executionResultName: string;
    };
    delays?: {
        estimate?: number;
        submit?: number;
        step?: number;
    };
    /** Pretend a developer fee profile matched the call. */
    suggestions?: boolean;
    /** Pending-queue depth shown in the review step. */
    queueAhead?: number;
    /** Simulate a gasless network (no deposit, no fee receipt). */
    gasless?: boolean;
}): TransactionKit;

export { CapsShield, type FeePreset, FeeReceipt, type FeesDistributionInput, type FlowState, GenLayerTransactionPanel, type Hex, HoldToSign, type PolicyInput, type PolicyQuote, PresetSelector, type SubmitInput, Timeline, type TrackedPhase, type TrackedStatus, type TransactionFlow, type TransactionKit, type TransactionPanelProps, VerifyBadge, createMockKit, describeError, describeOutcome, formatGen, formatWei, groupDigits, shortHash, splitGen, useTransactionFlow };
