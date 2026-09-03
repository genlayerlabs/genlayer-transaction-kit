import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type { TransactionFlow } from '../src/useTransactionFlow';
import { createMockKit } from '../src/mock';
import { useTransactionFlow } from '../src/useTransactionFlow';

const tx = { kind: 'deploy', code: 'class C: pass' } as const;
const fast = { estimate: 5, submit: 5, step: 5 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(assertion: () => void): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 1_000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(5);
    }
  }
  throw lastError;
}

function renderFlow(factory: () => TransactionFlow) {
  const scope = effectScope();
  let flow: TransactionFlow | undefined;
  scope.run(() => {
    flow = factory();
  });
  if (!flow) throw new Error('flow was not created');
  return {
    flow,
    stop: () => scope.stop(),
  };
}

describe('useTransactionFlow', () => {
  it('approves normally when verification is verified', async () => {
    const kit = createMockKit({ delays: fast });
    const { flow, stop } = renderFlow(() => useTransactionFlow({ kit, tx }));
    try {
      await waitFor(() => expect(flow.state.value.step).toBe('review'));
      expect(flow.quote.value?.verification.status).toBe('verified');
      await flow.approve();
      await waitFor(() => expect(flow.state.value.step).toBe('done'));
    } finally {
      stop();
    }
  });

  it('blocks approval when verification mismatches', async () => {
    const kit = createMockKit({ delays: fast, verificationStatus: 'mismatch' });
    const { flow, stop } = renderFlow(() => useTransactionFlow({ kit, tx }));
    try {
      await waitFor(() => expect(flow.state.value.step).toBe('blocked'));
      expect(flow.quote.value?.verification.status).toBe('mismatch');
      await flow.approve();
      expect(flow.state.value.step).toBe('blocked');
    } finally {
      stop();
    }
  });

  it('allows a mismatch when the kit opts into unverified approval', async () => {
    const kit = createMockKit({
      delays: fast,
      verificationStatus: 'mismatch',
      allowUnverified: true,
    });
    const { flow, stop } = renderFlow(() => useTransactionFlow({ kit, tx }));
    try {
      await waitFor(() => expect(flow.state.value.step).toBe('review'));
      expect(flow.quote.value?.verification.status).toBe('mismatch');
      await flow.approve();
      await waitFor(() => expect(flow.state.value.step).toBe('done'));
    } finally {
      stop();
    }
  });

  it('warns without blocking when verification is unavailable', async () => {
    const kit = createMockKit({ delays: fast, verificationStatus: 'unavailable' });
    const { flow, stop } = renderFlow(() => useTransactionFlow({ kit, tx }));
    try {
      await waitFor(() => expect(flow.state.value.step).toBe('review'));
      expect(flow.quote.value?.verification.status).toBe('unavailable');
      await flow.approve();
      await waitFor(() => expect(flow.state.value.step).toBe('done'));
    } finally {
      stop();
    }
  });

  it('late track updates cannot overwrite a cancel outcome', async () => {
    const base = createMockKit({ delays: fast });
    const pendingTxId = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    let emitLate: (() => void) | undefined;
    const kit = {
      ...base,
      cancel: async () => ({ transaction_hash: pendingTxId, status: 'CANCELED' }),
      track: async (
        genlayerTxId: `0x${string}`,
        onUpdate: (s: import('../src/contract').TrackedStatus) => void,
      ) => {
        onUpdate({ phase: 'pending' as const, genlayerTxId, queuePosition: 1 });
        // simulate a poll that lands after the user cancels
        emitLate = () => onUpdate({ phase: 'processing' as const, genlayerTxId });
        return new Promise<import('../src/contract').TrackedStatus>(() => undefined);
      },
    };
    const { flow, stop } = renderFlow(() => useTransactionFlow({ kit, tx }));
    try {
      await waitFor(() => expect(flow.state.value.step).toBe('review'));
      void flow.approve();
      await waitFor(() => expect(flow.canCancel.value).toBe(true));
      await flow.cancel();
      await waitFor(() => expect(flow.state.value.step).toBe('done'));

      emitLate?.();
      const state = flow.state.value;
      expect(state.step).toBe('done');
      if (state.step !== 'done') throw new Error('expected done');
      expect(state.status.statusName).toBe('CANCELED');
      expect(state.status.successful).toBe(false);
    } finally {
      stop();
    }
  });
});
