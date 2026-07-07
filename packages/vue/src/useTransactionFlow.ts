import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type {
  FeePreset,
  PolicyInput,
  PolicyQuote,
  SubmitInput,
  TrackedStatus,
  TransactionKit,
} from './contract';

export type FlowState =
  | { step: 'estimating'; preset: FeePreset }
  | { step: 'review'; preset: FeePreset; quote: PolicyQuote }
  | {
      step: 'blocked';
      preset: FeePreset;
      quote: PolicyQuote;
      reason: 'verification_mismatch';
      message: string;
    }
  | { step: 'signing'; preset: FeePreset; quote: PolicyQuote }
  | { step: 'tracking'; preset: FeePreset; quote: PolicyQuote; status: TrackedStatus }
  | { step: 'done'; preset: FeePreset; quote: PolicyQuote; status: TrackedStatus }
  | { step: 'error'; preset: FeePreset; quote?: PolicyQuote; message: string };

export type TransactionFlow = {
  state: Ref<FlowState>;
  preset: Ref<FeePreset>;
  overrides: Ref<PolicyInput['overrides']>;
  quote: ComputedRef<PolicyQuote | undefined>;
  verification: ComputedRef<{ feeConfigHash: string; summary: Record<string, string> } | undefined>;
  canCancel: ComputedRef<boolean>;
  canTopUp: ComputedRef<boolean>;
  approve: () => Promise<void>;
  cancel: () => Promise<void>;
  topUp: (value?: bigint) => Promise<void>;
  reset: () => void;
};

const VERIFICATION_MISMATCH_MESSAGE =
  'Fee policy verification mismatch. Re-estimate before signing, or create the kit with allowUnverified: true to override.';

const isVerificationBlocked = (
  quote: PolicyQuote,
  kit: TransactionKit,
): boolean => quote.verification.status === 'mismatch' && !kit.allowUnverified;

const isFeeStalled = (status: TrackedStatus): boolean => {
  const name = `${status.statusName ?? ''} ${status.executionResultName ?? ''}`;
  return /fee|fund|deposit|balance|insufficient/iu.test(name);
};

const isManageablePendingStatus = (status: TrackedStatus): boolean =>
  status.phase === 'submitted' || status.phase === 'pending' || isFeeStalled(status);

/** Vue composition mirror of the React useTransactionFlow state machine. */
export function useTransactionFlow(opts: {
  kit: TransactionKit;
  tx: SubmitInput;
  userValue?: bigint;
  trackUntil?: 'decided' | 'finalized';
}): TransactionFlow {
  const { kit, tx, userValue, trackUntil = 'decided' } = opts;
  const preset = ref<FeePreset>('standard');
  const overrides = shallowRef<PolicyInput['overrides']>(undefined);
  const state = shallowRef<FlowState>({ step: 'estimating', preset: 'standard' }) as Ref<FlowState>;
  let generation = 0;

  async function estimate(): Promise<void> {
    const gen = ++generation;
    state.value = { step: 'estimating', preset: preset.value };
    try {
      const quote = await kit.estimate(
        { preset: preset.value, overrides: overrides.value, userValue },
        tx,
      );
      if (generation !== gen) return;
      if (isVerificationBlocked(quote, kit)) {
        state.value = {
          step: 'blocked',
          preset: preset.value,
          quote,
          reason: 'verification_mismatch',
          message: VERIFICATION_MISMATCH_MESSAGE,
        };
      } else {
        state.value = { step: 'review', preset: preset.value, quote };
      }
    } catch (error) {
      if (generation !== gen) return;
      state.value = {
        step: 'error',
        preset: preset.value,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  watch([preset, overrides], () => void estimate(), { immediate: true });

  const quote = computed(() => ('quote' in state.value ? state.value.quote : undefined));

  const verification = computed(() => {
    const current = quote.value;
    if (!current) return undefined;
    try {
      return kit.verification(current, tx);
    } catch {
      return undefined;
    }
  });

  async function approve(): Promise<void> {
    const current = state.value;
    if (current.step !== 'review') return;
    const approvedQuote = current.quote;
    if (isVerificationBlocked(approvedQuote, kit)) {
      state.value = {
        step: 'blocked',
        preset: current.preset,
        quote: approvedQuote,
        reason: 'verification_mismatch',
        message: VERIFICATION_MISMATCH_MESSAGE,
      };
      return;
    }
    // Capture the flow generation: cancel() (and a fresh estimate) bump it,
    // after which every update from this approve/track run must be dropped —
    // otherwise a late track poll overwrites the cancel outcome.
    const gen = generation;
    state.value = { step: 'signing', preset: current.preset, quote: approvedQuote };
    try {
      const { genlayerTxId, evmTxHash } = await kit.submit(approvedQuote, tx);
      let last: TrackedStatus = { phase: 'submitted', genlayerTxId, evmTxHash };
      if (generation !== gen) return;
      state.value = { step: 'tracking', preset: current.preset, quote: approvedQuote, status: last };
      last = await kit.track(
        genlayerTxId,
        (status) => {
          last = { evmTxHash, ...status };
          if (generation !== gen) return;
          state.value = {
            step: 'tracking',
            preset: current.preset,
            quote: approvedQuote,
            status: last,
          };
        },
        { until: trackUntil },
      );
      if (generation !== gen) return;
      state.value = {
        step: 'done',
        preset: current.preset,
        quote: approvedQuote,
        status: { evmTxHash, ...last },
      };
    } catch (error) {
      if (generation !== gen) return;
      state.value = {
        step: 'error',
        preset: current.preset,
        quote: approvedQuote,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const canCancel = computed(() => {
    const current = state.value;
    return (
      current.step === 'tracking' &&
      current.status.genlayerTxId !== undefined &&
      isManageablePendingStatus(current.status)
    );
  });

  const canTopUp = computed(() => {
    const current = state.value;
    return canCancel.value && current.step === 'tracking' && !current.quote.gasless;
  });

  async function cancel(): Promise<void> {
    const current = state.value;
    if (
      current.step !== 'tracking' ||
      current.status.genlayerTxId === undefined ||
      !isManageablePendingStatus(current.status)
    ) {
      return;
    }
    const genlayerTxId = current.status.genlayerTxId;
    // Supersede the in-flight approve/track run so its late updates can't
    // overwrite the cancel outcome; then guard our own async continuation.
    const gen = ++generation;
    try {
      const result = await kit.cancel({ hash: genlayerTxId });
      if (generation !== gen) return;
      state.value = {
        step: 'done',
        preset: current.preset,
        quote: current.quote,
        status: {
          ...current.status,
          phase: 'decided',
          statusName: result.status || 'CANCELED',
          successful: false,
        },
      };
    } catch (error) {
      if (generation !== gen) return;
      state.value = {
        step: 'error',
        preset: current.preset,
        quote: current.quote,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function topUp(value?: bigint): Promise<void> {
    const current = state.value;
    if (
      current.step !== 'tracking' ||
      current.status.genlayerTxId === undefined ||
      current.quote.gasless ||
      !isManageablePendingStatus(current.status)
    ) {
      return;
    }
    const genlayerTxId = current.status.genlayerTxId;
    try {
      await kit.topUp({
        txId: genlayerTxId,
        distribution: current.quote.distribution,
        value: value ?? current.quote.feeValue,
      });
    } catch (error) {
      state.value = {
        step: 'error',
        preset: current.preset,
        quote: current.quote,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    state,
    preset,
    overrides,
    quote,
    verification,
    canCancel,
    canTopUp,
    approve,
    cancel,
    topUp,
    reset: () => void estimate(),
  };
}
