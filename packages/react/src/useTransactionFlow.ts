import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  state: FlowState;
  preset: FeePreset;
  setPreset: (p: FeePreset) => void;
  overrides: PolicyInput['overrides'];
  setOverrides: (o: PolicyInput['overrides']) => void;
  quote: PolicyQuote | undefined;
  verification: { feeConfigHash: string; summary: Record<string, string> } | undefined;
  canCancel: boolean;
  canTopUp: boolean;
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

/**
 * Headless state machine for the approve-and-sign flow.
 * estimating → review → signing → tracking → done | error
 * Changing the preset or overrides re-estimates and returns to review.
 */
export function useTransactionFlow(opts: {
  kit: TransactionKit;
  tx: SubmitInput;
  userValue?: bigint;
  trackUntil?: 'decided' | 'finalized';
}): TransactionFlow {
  const { kit, tx, userValue, trackUntil = 'decided' } = opts;
  const [preset, setPreset] = useState<FeePreset>('standard');
  const [overrides, setOverrides] = useState<PolicyInput['overrides']>(undefined);
  const [state, setState] = useState<FlowState>({ step: 'estimating', preset: 'standard' });
  const generation = useRef(0);

  const estimate = useCallback(async () => {
    const gen = ++generation.current;
    setState({ step: 'estimating', preset });
    try {
      const quote = await kit.estimate({ preset, overrides, userValue }, tx);
      if (generation.current !== gen) return;
      if (isVerificationBlocked(quote, kit)) {
        setState({
          step: 'blocked',
          preset,
          quote,
          reason: 'verification_mismatch',
          message: VERIFICATION_MISMATCH_MESSAGE,
        });
      } else {
        setState({ step: 'review', preset, quote });
      }
    } catch (error) {
      if (generation.current !== gen) return;
      setState({
        step: 'error',
        preset,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, preset, overrides, userValue, tx]);

  useEffect(() => {
    void estimate();
  }, [estimate]);

  const quote = 'quote' in state ? state.quote : undefined;

  const verification = useMemo(() => {
    if (!quote) return undefined;
    try {
      return kit.verification(quote, tx);
    } catch {
      return undefined;
    }
  }, [kit, quote, tx]);

  const approve = useCallback(async () => {
    if (state.step !== 'review') return;
    const { quote: approvedQuote } = state;
    const approvedPreset = state.preset;
    if (isVerificationBlocked(approvedQuote, kit)) {
      setState({
        step: 'blocked',
        preset: approvedPreset,
        quote: approvedQuote,
        reason: 'verification_mismatch',
        message: VERIFICATION_MISMATCH_MESSAGE,
      });
      return;
    }
    // Capture the flow generation: cancel() (and a fresh estimate) bump it,
    // after which every update from this approve/track run must be dropped —
    // otherwise a late track poll overwrites the cancel outcome.
    const gen = generation.current;
    setState({ step: 'signing', preset: approvedPreset, quote: approvedQuote });
    try {
      const { genlayerTxId, evmTxHash } = await kit.submit(approvedQuote, tx);
      let last: TrackedStatus = { phase: 'submitted', genlayerTxId, evmTxHash };
      if (generation.current !== gen) return;
      setState({ step: 'tracking', preset: approvedPreset, quote: approvedQuote, status: last });
      last = await kit.track(
        genlayerTxId,
        (status) => {
          last = { evmTxHash, ...status };
          if (generation.current !== gen) return;
          setState({ step: 'tracking', preset: approvedPreset, quote: approvedQuote, status: last });
        },
        { until: trackUntil },
      );
      if (generation.current !== gen) return;
      setState({ step: 'done', preset: approvedPreset, quote: approvedQuote, status: { evmTxHash, ...last } });
    } catch (error) {
      if (generation.current !== gen) return;
      setState({
        step: 'error',
        preset: approvedPreset,
        quote: approvedQuote,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [kit, state, preset, tx, trackUntil]);

  const manageableTracking =
    state.step === 'tracking' &&
    state.status.genlayerTxId !== undefined &&
    isManageablePendingStatus(state.status);
  const canCancel = manageableTracking;
  const canTopUp = manageableTracking && !state.quote.gasless;

  const cancel = useCallback(async () => {
    if (
      state.step !== 'tracking' ||
      state.status.genlayerTxId === undefined ||
      !isManageablePendingStatus(state.status)
    ) {
      return;
    }
    const genlayerTxId = state.status.genlayerTxId;
    const current = state;
    // Supersede the in-flight approve/track run so its late updates can't
    // overwrite the cancel outcome; then guard our own async continuation.
    const gen = ++generation.current;
    try {
      const result = await kit.cancel({ hash: genlayerTxId });
      if (generation.current !== gen) return;
      setState({
        step: 'done',
        preset: current.preset,
        quote: current.quote,
        status: {
          ...current.status,
          phase: 'decided',
          statusName: result.status || 'CANCELED',
          successful: false,
        },
      });
    } catch (error) {
      if (generation.current !== gen) return;
      setState({
        step: 'error',
        preset: current.preset,
        quote: current.quote,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [kit, state]);

  const topUp = useCallback(async (value?: bigint) => {
    if (
      state.step !== 'tracking' ||
      state.status.genlayerTxId === undefined ||
      state.quote.gasless ||
      !isManageablePendingStatus(state.status)
    ) {
      return;
    }
    const genlayerTxId = state.status.genlayerTxId;
    const current = state;
    try {
      await kit.topUp({
        txId: genlayerTxId,
        distribution: current.quote.distribution,
        value: value ?? current.quote.feeValue,
      });
    } catch (error) {
      setState({
        step: 'error',
        preset: current.preset,
        quote: current.quote,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [kit, state]);

  const reset = useCallback(() => {
    void estimate();
  }, [estimate]);

  return {
    state,
    preset,
    setPreset,
    overrides,
    setOverrides,
    quote,
    verification,
    canCancel,
    canTopUp,
    approve,
    cancel,
    topUp,
    reset,
  };
}
