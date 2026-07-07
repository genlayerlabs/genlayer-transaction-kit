// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TrackedStatus, TransactionKit } from '../src/contract';
import { createMockKit } from '../src/mock';
import { useTransactionFlow } from '../src/useTransactionFlow';

const tx = { kind: 'deploy', code: 'class C: pass' } as const;
const fast = { estimate: 5, submit: 5, step: 5 };
const pendingTxId = ('0x' + 'ab'.repeat(32)) as const;

function createPendingKit(): {
  kit: TransactionKit;
  cancel: ReturnType<typeof vi.fn>;
  topUp: ReturnType<typeof vi.fn>;
} {
  const base = createMockKit({ delays: fast });
  const cancel = vi.fn(async () => ({
    transaction_hash: pendingTxId,
    status: 'CANCELED',
  }));
  const topUp = vi.fn(async () => ('0x' + 'ef'.repeat(32)) as `0x${string}`);
  const track = vi.fn(async (genlayerTxId: `0x${string}`, onUpdate: (s: TrackedStatus) => void) => {
    onUpdate({ phase: 'pending', genlayerTxId, queuePosition: 1 });
    return new Promise<TrackedStatus>(() => undefined);
  });
  return { kit: { ...base, cancel, topUp, track }, cancel, topUp };
}

describe('useTransactionFlow', () => {
  it('estimates into review, approves through tracking to done', async () => {
    const kit = createMockKit({ delays: fast });
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    expect(result.current.quote?.total).toBeGreaterThan(0n);
    await act(async () => {
      await result.current.approve();
    });
    await waitFor(() => expect(result.current.state.step).toBe('done'));
    const state = result.current.state;
    if (state.step !== 'done') throw new Error('expected done');
    expect(state.status.successful).toBe(true);
  });

  it('UNDETERMINED outcome lands as done but not successful', async () => {
    const kit = createMockKit({
      delays: fast,
      outcome: { statusName: 'UNDETERMINED', executionResultName: 'FINISHED_WITH_RETURN' },
    });
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    await act(async () => {
      await result.current.approve();
    });
    await waitFor(() => expect(result.current.state.step).toBe('done'));
    const state = result.current.state;
    if (state.step !== 'done') throw new Error('expected done');
    expect(state.status.successful).toBe(false);
  });

  it('wallet rejection surfaces as a named error', async () => {
    const kit = createMockKit({ delays: fast, failWith: 'user rejected the request (4001)' });
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    await act(async () => {
      await result.current.approve();
    });
    await waitFor(() => expect(result.current.state.step).toBe('error'));
  });

  it('blocks approval when verification mismatches', async () => {
    const kit = createMockKit({ delays: fast, verificationStatus: 'mismatch' });
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('blocked'));
    expect(result.current.quote?.verification.status).toBe('mismatch');
    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.state.step).toBe('blocked');
  });

  it('allows a verification mismatch when the kit opts into unverified approval', async () => {
    const kit = createMockKit({
      delays: fast,
      verificationStatus: 'mismatch',
      allowUnverified: true,
    });
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    expect(result.current.quote?.verification.status).toBe('mismatch');
    await act(async () => {
      await result.current.approve();
    });
    await waitFor(() => expect(result.current.state.step).toBe('done'));
  });

  it('warns without blocking when verification is unavailable', async () => {
    const kit = createMockKit({ delays: fast, verificationStatus: 'unavailable' });
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    expect(result.current.quote?.verification.status).toBe('unavailable');
    await act(async () => {
      await result.current.approve();
    });
    await waitFor(() => expect(result.current.state.step).toBe('done'));
  });

  it('exposes cancel and top-up actions while a transaction is pending', async () => {
    const { kit, cancel, topUp } = createPendingKit();
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    const quote = result.current.quote;
    if (!quote) throw new Error('expected quote');

    act(() => {
      void result.current.approve();
    });

    await waitFor(() => expect(result.current.canCancel).toBe(true));
    expect(result.current.canTopUp).toBe(true);

    await act(async () => {
      await result.current.topUp();
    });
    expect(topUp).toHaveBeenCalledWith({
      txId: pendingTxId,
      distribution: quote.distribution,
      value: quote.feeValue,
    });

    await act(async () => {
      await result.current.cancel();
    });
    expect(cancel).toHaveBeenCalledWith({ hash: pendingTxId });
    await waitFor(() => expect(result.current.state.step).toBe('done'));
  });

  it('late track updates cannot overwrite a cancel outcome', async () => {
    let emitLate: (() => void) | undefined;
    const base = createMockKit({ delays: fast });
    const cancel = vi.fn(async () => ({
      transaction_hash: pendingTxId,
      status: 'CANCELED',
    }));
    const track = vi.fn(
      async (genlayerTxId: `0x${string}`, onUpdate: (s: TrackedStatus) => void) => {
        onUpdate({ phase: 'pending', genlayerTxId, queuePosition: 1 });
        // simulate a poll that lands after the user cancels
        emitLate = () => onUpdate({ phase: 'processing', genlayerTxId });
        return new Promise<TrackedStatus>(() => undefined);
      },
    );
    const kit: TransactionKit = { ...base, cancel, track };
    const { result } = renderHook(() => useTransactionFlow({ kit, tx }));
    await waitFor(() => expect(result.current.state.step).toBe('review'));
    act(() => {
      void result.current.approve();
    });
    await waitFor(() => expect(result.current.canCancel).toBe(true));
    await act(async () => {
      await result.current.cancel();
    });
    await waitFor(() => expect(result.current.state.step).toBe('done'));

    act(() => {
      emitLate?.();
    });
    const state = result.current.state;
    expect(state.step).toBe('done');
    if (state.step !== 'done') throw new Error('expected done');
    expect(state.status.statusName).toBe('CANCELED');
    expect(state.status.successful).toBe(false);
  });
});
