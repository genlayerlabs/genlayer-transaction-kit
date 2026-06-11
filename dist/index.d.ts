import * as vue from 'vue';
import { Ref, ComputedRef, PropType } from 'vue';

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
    state: Ref<FlowState>;
    preset: Ref<FeePreset>;
    overrides: Ref<PolicyInput['overrides']>;
    quote: ComputedRef<PolicyQuote | undefined>;
    verification: ComputedRef<{
        feeConfigHash: string;
        summary: Record<string, string>;
    } | undefined>;
    approve: () => Promise<void>;
    reset: () => void;
};
/** Vue composition mirror of the React useTransactionFlow state machine. */
declare function useTransactionFlow(opts: {
    kit: TransactionKit;
    tx: SubmitInput;
    userValue?: bigint;
    trackUntil?: 'decided' | 'finalized';
}): TransactionFlow;

declare const FeeReceipt: vue.DefineComponent<vue.ExtractPropTypes<{
    quote: {
        type: PropType<PolicyQuote>;
        required: true;
    };
    busy: {
        type: BooleanConstructor;
        default: boolean;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, {}, string, vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    quote: {
        type: PropType<PolicyQuote>;
        required: true;
    };
    busy: {
        type: BooleanConstructor;
        default: boolean;
    };
}>> & Readonly<{}>, {
    busy: boolean;
}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;
declare const PresetSelector: vue.DefineComponent<vue.ExtractPropTypes<{
    modelValue: {
        type: PropType<FeePreset>;
        required: true;
    };
    disabled: {
        type: BooleanConstructor;
        default: boolean;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, "update:modelValue"[], "update:modelValue", vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    modelValue: {
        type: PropType<FeePreset>;
        required: true;
    };
    disabled: {
        type: BooleanConstructor;
        default: boolean;
    };
}>> & Readonly<{
    "onUpdate:modelValue"?: ((...args: any[]) => any) | undefined;
}>, {
    disabled: boolean;
}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;
declare const CapsShield: vue.DefineComponent<vue.ExtractPropTypes<{
    quote: {
        type: PropType<PolicyQuote>;
        required: true;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, {}, string, vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    quote: {
        type: PropType<PolicyQuote>;
        required: true;
    };
}>> & Readonly<{}>, {}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;
declare const HoldToSign: vue.DefineComponent<vue.ExtractPropTypes<{
    disabled: {
        type: BooleanConstructor;
        default: boolean;
    };
    holdMs: {
        type: NumberConstructor;
        default: number;
    };
    label: {
        type: StringConstructor;
        default: string;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, "confirm"[], "confirm", vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    disabled: {
        type: BooleanConstructor;
        default: boolean;
    };
    holdMs: {
        type: NumberConstructor;
        default: number;
    };
    label: {
        type: StringConstructor;
        default: string;
    };
}>> & Readonly<{
    onConfirm?: ((...args: any[]) => any) | undefined;
}>, {
    label: string;
    disabled: boolean;
    holdMs: number;
}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;
declare const Timeline: vue.DefineComponent<vue.ExtractPropTypes<{
    status: {
        type: PropType<TrackedStatus>;
        required: true;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, {}, string, vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    status: {
        type: PropType<TrackedStatus>;
        required: true;
    };
}>> & Readonly<{}>, {}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;
declare const GenLayerTransactionPanel: vue.DefineComponent<vue.ExtractPropTypes<{
    kit: {
        type: PropType<TransactionKit>;
        required: true;
    };
    tx: {
        type: PropType<SubmitInput>;
        required: true;
    };
    userValue: {
        type: PropType<bigint>;
        default: undefined;
    };
    network: {
        type: StringConstructor;
        default: undefined;
    };
    theme: {
        type: PropType<"dark" | "light">;
        default: string;
    };
    trackUntil: {
        type: PropType<"decided" | "finalized">;
        default: string;
    };
    snapState: {
        type: PropType<"verified" | "unavailable">;
        default: undefined;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, "done"[], "done", vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    kit: {
        type: PropType<TransactionKit>;
        required: true;
    };
    tx: {
        type: PropType<SubmitInput>;
        required: true;
    };
    userValue: {
        type: PropType<bigint>;
        default: undefined;
    };
    network: {
        type: StringConstructor;
        default: undefined;
    };
    theme: {
        type: PropType<"dark" | "light">;
        default: string;
    };
    trackUntil: {
        type: PropType<"decided" | "finalized">;
        default: string;
    };
    snapState: {
        type: PropType<"verified" | "unavailable">;
        default: undefined;
    };
}>> & Readonly<{
    onDone?: ((...args: any[]) => any) | undefined;
}>, {
    userValue: bigint;
    trackUntil: "decided" | "finalized";
    network: string;
    theme: "dark" | "light";
    snapState: "verified" | "unavailable";
}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;

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

export { CapsShield, type FeePreset, FeeReceipt, type FeesDistributionInput, type FlowState, GenLayerTransactionPanel, type Hex, HoldToSign, type PolicyInput, type PolicyQuote, PresetSelector, type SubmitInput, Timeline, type TrackedPhase, type TrackedStatus, type TransactionFlow, type TransactionKit, createMockKit, describeError, describeOutcome, formatGen, formatWei, groupDigits, shortHash, splitGen, useTransactionFlow };
