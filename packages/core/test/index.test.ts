import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeesDistribution, GenLayerChain } from 'genlayer-js/types';
import type { SubmitInput } from '../src/index';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  isSuccessful: vi.fn((transaction: Record<string, unknown>) => {
    return (
      transaction.statusName === 'ACCEPTED' &&
      transaction.txExecutionResultName === 'FINISHED_WITH_RETURN'
    );
  }),
}));

vi.mock('genlayer-js', () => ({
  createClient: mocks.createClient,
  isSuccessful: mocks.isSuccessful,
  transactionsStatusNumberToName: {
    '0': 'UNINITIALIZED',
    '1': 'PENDING',
    '2': 'PROPOSING',
    '3': 'COMMITTING',
    '4': 'REVEALING',
    '5': 'ACCEPTED',
    '6': 'UNDETERMINED',
    '7': 'FINALIZED',
    '8': 'CANCELED',
    '12': 'VALIDATORS_TIMEOUT',
    '13': 'LEADER_TIMEOUT',
  },
  executionResultNumberToName: {
    '0': 'NOT_VOTED',
    '1': 'FINISHED_WITH_RETURN',
    '2': 'FINISHED_WITH_ERROR',
    '3': 'TIMEOUT',
    '4': 'NONDET_DISAGREE',
  },
}));

const chain = {
  id: 61999,
  name: 'GenLayer Studio',
  rpcUrls: { default: { http: ['https://studio.genlayer.com/api'] } },
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  isStudio: true,
} as unknown as GenLayerChain;

const distribution = (overrides: Partial<FeesDistribution> = {}) =>
  ({
    leaderTimeunitsAllocation: 10n,
    validatorTimeunitsAllocation: 20n,
    appealRounds: 1n,
    executionBudgetPerRound: 100n,
    executionConsumed: 0n,
    totalMessageFees: 20n,
    rotations: [0n, 0n],
    maxPriceGenPerTimeUnit: 3n,
    storageFeeMaxGasPrice: 4n,
    receiptFeeMaxGasPrice: 5n,
    ...overrides,
  }) satisfies FeesDistribution;

const feePolicy = (overrides: Record<string, bigint | boolean> = {}) => ({
  enabled: true,
  genPerTimeUnit: 2n,
  storageUnitPrice: 3n,
  receiptGasPrice: 4n,
  executionBudgetFloor: 0n,
  ...overrides,
});

const provider = (hash = `0x${'a'.repeat(64)}`) => ({
  request: vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_sendTransaction') {
      return hash;
    }
    return undefined;
  }),
});

describe('transaction kit core', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.isSuccessful.mockClear();
  });

  it('returns coherent policy quotes and uses the standard preset by default', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution(),
        feeValue: 350n,
        policy: {
          enabled: true,
          genPerTimeUnit: 3n,
          storageUnitPrice: 4n,
          receiptGasPrice: 5n,
          executionBudgetFloor: 0n,
        },
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const quote = await kit.estimate({ userValue: 7n });

    expect(client.estimateTransactionFees).toHaveBeenCalledWith({
      appealRounds: 3n,
      rotations: [0n, 0n, 0n, 0n],
    });
    expect(quote.total).toBe(357n);
    expect(quote.breakdown.executionBudget).toBe(300n);
    expect(quote.breakdown.messageFees).toBe(20n);
    expect(quote.breakdown.timeUnitFees).toBe(30n);
    expect(
      quote.breakdown.executionBudget +
        quote.breakdown.messageFees +
        quote.breakdown.timeUnitFees,
    ).toBeLessThanOrEqual(quote.feeValue);
    expect(quote.refundable).toBe(true);
  });

  it('never simulates the call live — writes estimate from prices only', async () => {
    const client = {
      estimateTransactionFeesForWrite: vi.fn(),
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution({ appealRounds: 2n, rotations: [0n, 0n, 0n] }),
        feeValue: 600n,
        policy: {
          enabled: true,
          genPerTimeUnit: 3n,
          storageUnitPrice: 4n,
          receiptGasPrice: 5n,
          executionBudgetFloor: 0n,
        },
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const quote = await kit.estimate(
      { preset: 'high', userValue: 9n },
      {
        kind: 'write',
        address: `0x${'2'.repeat(40)}`,
        method: 'update_storage',
        args: ['value'],
      },
    );

    expect(client.estimateTransactionFees).toHaveBeenCalledWith({
      appealRounds: 5n,
      rotations: [0n, 0n, 0n, 0n, 0n, 0n],
    });
    expect(client.estimateTransactionFeesForWrite).not.toHaveBeenCalled();
    expect(quote.source).toBe('network-default');
  });

  it('seeds the estimate from a matching developer suggestion', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution({ appealRounds: 1n, rotations: [0n, 0n] }),
        feeValue: 500n,
        policy: {
          enabled: true,
          genPerTimeUnit: 3n,
          storageUnitPrice: 4n,
          receiptGasPrice: 5n,
          executionBudgetFloor: 0n,
        },
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
      suggestions: {
        methods: {
          update_storage: {
            leaderTimeunitsAllocation: '1100',
            validatorTimeunitsAllocation: '2200',
            executionBudgetPerRound: '229600000000000',
          },
        },
      },
    });

    const quote = await kit.estimate(
      { preset: 'standard' },
      {
        kind: 'write',
        address: `0x${'2'.repeat(40)}`,
        method: 'update_storage',
      },
    );

    expect(client.estimateTransactionFees).toHaveBeenCalledWith({
      appealRounds: 3n,
      rotations: [0n, 0n, 0n, 0n],
      leaderTimeunitsAllocation: '1100',
      validatorTimeunitsAllocation: '2200',
      executionBudgetPerRound: '229600000000000',
    });
    expect(quote.source).toBe('developer');
  });

  it('marks gasless networks and submits without fee params', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution({
          leaderTimeunitsAllocation: 0n,
          validatorTimeunitsAllocation: 0n,
          executionBudgetPerRound: 0n,
          totalMessageFees: 0n,
          maxPriceGenPerTimeUnit: 0n,
          storageFeeMaxGasPrice: 0n,
          receiptFeeMaxGasPrice: 0n,
        }),
        feeValue: 0n,
        policy: {
          enabled: false,
          genPerTimeUnit: 0n,
          storageUnitPrice: 0n,
          receiptGasPrice: 0n,
          executionBudgetFloor: 0n,
        },
      })),
      writeContract: vi.fn(async () => `0x${'d'.repeat(64)}`),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const tx: SubmitInput = {
      kind: 'write',
      address: `0x${'2'.repeat(40)}`,
      method: 'update_storage',
    };
    const quote = await kit.estimate({ preset: 'standard' }, tx);
    expect(quote.gasless).toBe(true);
    expect(quote.total).toBe(0n);

    await kit.submit(quote, tx);
    const callArgs = (client.writeContract.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(callArgs.fees).toBeUndefined();
  });

  it('reads pending-queue depth for writes via the consensus passthrough', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution(),
        feeValue: 500n,
        policy: {
          enabled: true,
          genPerTimeUnit: 3n,
          storageUnitPrice: 4n,
          receiptGasPrice: 5n,
          executionBudgetFloor: 0n,
        },
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const queuesAddress = `0x${'9'.repeat(40)}`;
    const provider = {
      request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method !== 'eth_call') return undefined;
        const call = (params as [{ to: string; data: string }])[0];
        if (call.data.startsWith('0xe605bca4') || call.data.length === 10) {
          // ConsensusMain.queues()
          return `0x${'0'.repeat(24)}${queuesAddress.slice(2)}`;
        }
        // Queues.getPendingTxCount(address)
        return `0x${'0'.repeat(63)}4`;
      }),
    };

    const { createTransactionKit } = await import('../src/index');
    const chainWithConsensus = {
      ...(chain as object),
      consensusMainContract: { address: `0x${'8'.repeat(40)}` },
    } as never;
    const kit = createTransactionKit({
      chain: chainWithConsensus,
      provider,
      account: `0x${'1'.repeat(40)}`,
    });

    const quote = await kit.estimate(
      { preset: 'standard' },
      { kind: 'write', address: `0x${'2'.repeat(40)}`, method: 'place_bet' },
    );

    expect(quote.queue).toEqual({ pendingAhead: 4 });

    const deployQuote = await kit.estimate(
      { preset: 'standard' },
      { kind: 'deploy', code: 'class C: pass' },
    );
    expect(deployQuote.queue).toBeUndefined();
  });

  it('ignores suggestions for methods without a profile entry', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution({ appealRounds: 1n, rotations: [0n, 0n] }),
        feeValue: 500n,
        policy: {
          enabled: true,
          genPerTimeUnit: 3n,
          storageUnitPrice: 4n,
          receiptGasPrice: 5n,
          executionBudgetFloor: 0n,
        },
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
      suggestions: { methods: { other_method: { executionBudgetPerRound: '1' } } },
    });

    const quote = await kit.estimate(
      { preset: 'standard' },
      { kind: 'write', address: `0x${'2'.repeat(40)}`, method: 'update_storage' },
    );

    expect(client.estimateTransactionFees).toHaveBeenCalledWith({
      appealRounds: 3n,
      rotations: [0n, 0n, 0n, 0n],
    });
    expect(quote.source).toBe('network-default');
  });

  it('submits through the SDK provider path and returns the captured EVM hash', async () => {
    const evmTxHash = `0x${'b'.repeat(64)}` as const;
    const injected = provider(evmTxHash);
    let sdkProvider: typeof injected | undefined;
    const client = {
      writeContract: vi.fn(async () => {
        await sdkProvider?.request({
          method: 'eth_sendTransaction',
          params: [{ to: `0x${'3'.repeat(40)}` }],
        });
        return `0x${'c'.repeat(64)}`;
      }),
    };
    mocks.createClient.mockImplementation((config) => {
      sdkProvider = config.provider;
      return client;
    });

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: injected,
      account: `0x${'1'.repeat(40)}`,
    });
    const quote = {
      distribution: distribution(),
      feeValue: 350n,
      userValue: 11n,
      total: 361n,
      breakdown: {
        timeUnitFees: 30n,
        executionBudget: 300n,
        messageFees: 20n,
      },
      caps: {
        genPerTimeUnit: 3n,
        storagePrice: 4n,
        receiptPrice: 5n,
      },
      source: 'network-default' as const,
      verification: {
        status: 'verified' as const,
        expectedHash: `0x${'0'.repeat(64)}` as const,
        actualHash: `0x${'0'.repeat(64)}` as const,
      },
      refundable: true,
    } as const;

    const result = await kit.submit(quote, {
      kind: 'write',
      address: `0x${'2'.repeat(40)}`,
      method: 'store',
      args: ['x'],
    });

    expect(client.writeContract).toHaveBeenCalledWith({
      fees: {
        distribution: quote.distribution,
        feeValue: 350n,
      },
      value: 11n,
      address: `0x${'2'.repeat(40)}`,
      functionName: 'store',
      args: ['x'],
    });
    expect(injected.request).toHaveBeenCalledWith({
      method: 'eth_sendTransaction',
      params: [{ to: `0x${'3'.repeat(40)}` }],
    });
    expect(result).toEqual({
      genlayerTxId: `0x${'c'.repeat(64)}`,
      evmTxHash,
    });
  });

  it('cancels through the SDK cancelTransaction path', async () => {
    const hash = `0x${'f'.repeat(64)}` as const;
    const client = {
      cancelTransaction: vi.fn(async () => ({
        transaction_hash: hash,
        status: 'CANCELED',
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const result = await kit.cancel({ hash });

    expect(client.cancelTransaction).toHaveBeenCalledWith({ hash });
    expect(result).toEqual({ transaction_hash: hash, status: 'CANCELED' });
  });

  it('tops up fees through the SDK topUpFees path', async () => {
    const txId = `0x${'e'.repeat(64)}` as const;
    const evmHash = `0x${'a'.repeat(64)}` as const;
    const fees = distribution();
    const client = {
      topUpFees: vi.fn(async () => evmHash),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const result = await kit.topUp({
      txId,
      distribution: fees,
      value: 123n,
    });

    expect(client.topUpFees).toHaveBeenCalledWith({
      txId,
      distribution: fees,
      value: 123n,
    });
    expect(result).toBe(evmHash);
  });

  it('propagates wallet rejections from cancel and top-up', async () => {
    const client = {
      cancelTransaction: vi.fn(async () => {
        throw new Error('user rejected the request (4001)');
      }),
      topUpFees: vi.fn(async () => {
        throw new Error('user rejected the request (4001)');
      }),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    await expect(kit.cancel({ hash: `0x${'f'.repeat(64)}` })).rejects.toThrow(
      /rejected/u,
    );
    await expect(
      kit.topUp({
        txId: `0x${'e'.repeat(64)}`,
        distribution: distribution(),
        value: 1n,
      }),
    ).rejects.toThrow(/rejected/u);
  });

  it('propagates unknown transaction errors from cancel and top-up', async () => {
    const client = {
      cancelTransaction: vi.fn(async () => {
        throw new Error('unknown transaction');
      }),
      topUpFees: vi.fn(async () => {
        throw new Error('unknown transaction');
      }),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    await expect(kit.cancel({ hash: `0x${'f'.repeat(64)}` })).rejects.toThrow(
      /unknown transaction/u,
    );
    await expect(
      kit.topUp({
        txId: `0x${'e'.repeat(64)}`,
        distribution: distribution(),
        value: 1n,
      }),
    ).rejects.toThrow(/unknown transaction/u);
  });

  it('tracks submitted to decided and maps successful transactions', async () => {
    const client = {
      getTransaction: vi.fn(async () => ({
        statusName: 'ACCEPTED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        txId: `0x${'d'.repeat(64)}`,
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });
    const updates: unknown[] = [];

    const final = await kit.track(
      `0x${'d'.repeat(64)}`,
      (status) => updates.push(status),
      { until: 'decided' },
    );

    expect(updates).toMatchObject([
      { phase: 'submitted' },
      {
        phase: 'decided',
        statusName: 'ACCEPTED',
        executionResultName: 'FINISHED_WITH_RETURN',
        successful: true,
      },
    ]);
    expect(final.successful).toBe(true);
  });

  it('does not mark UNDETERMINED plus FINISHED_WITH_RETURN as successful', async () => {
    const client = {
      getTransaction: vi.fn(async () => ({
        statusName: 'UNDETERMINED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        txId: `0x${'e'.repeat(64)}`,
      })),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const final = await kit.track(
      `0x${'e'.repeat(64)}`,
      () => undefined,
      { until: 'decided' },
    );

    expect(final).toMatchObject({
      phase: 'decided',
      statusName: 'UNDETERMINED',
      executionResultName: 'FINISHED_WITH_RETURN',
      successful: false,
    });
  });

  it('marks estimates verified when the current fee policy matches the quote hash', async () => {
    const policy = feePolicy();
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution(),
        feeValue: 350n,
        policy,
      })),
      getCurrentFeePolicy: vi.fn(async () => policy),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const quote = await kit.estimate(
      { preset: 'standard' },
      { kind: 'deploy', code: 'class C: pass' },
    );

    expect(client.getCurrentFeePolicy).toHaveBeenCalled();
    expect(quote.verification.status).toBe('verified');
    expect(quote.verification.expectedHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(quote.verification.actualHash).toBe(quote.verification.expectedHash);
  });

  it('marks estimates mismatched when the live fee policy hash differs', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution(),
        feeValue: 350n,
        policy: feePolicy(),
      })),
      getCurrentFeePolicy: vi.fn(async () =>
        feePolicy({ genPerTimeUnit: 3n }),
      ),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const quote = await kit.estimate(
      { preset: 'standard' },
      { kind: 'deploy', code: 'class C: pass' },
    );

    expect(quote.verification.status).toBe('mismatch');
    expect(quote.verification.expectedHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(quote.verification.actualHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(quote.verification.actualHash).not.toBe(quote.verification.expectedHash);
  });

  it('marks verification unavailable when the fee policy read fails', async () => {
    const client = {
      estimateTransactionFees: vi.fn(async () => ({
        distribution: distribution(),
        feeValue: 350n,
        policy: feePolicy(),
      })),
      getCurrentFeePolicy: vi.fn(async () => {
        throw new Error('fee policy unavailable');
      }),
    };
    mocks.createClient.mockReturnValue(client);

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });

    const quote = await kit.estimate(
      { preset: 'standard' },
      { kind: 'deploy', code: 'class C: pass' },
    );

    expect(quote.verification.status).toBe('unavailable');
    expect(quote.verification.expectedHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(quote.verification.actualHash).toBeUndefined();
  });

  it('returns a stable verification hash for identical quotes', async () => {
    mocks.createClient.mockReturnValue({});

    const { createTransactionKit } = await import('../src/index');
    const kit = createTransactionKit({
      chain,
      provider: provider(),
      account: `0x${'1'.repeat(40)}`,
    });
    const quote = {
      distribution: distribution(),
      feeValue: 350n,
      userValue: 0n,
      total: 350n,
      breakdown: {
        timeUnitFees: 30n,
        executionBudget: 300n,
        messageFees: 20n,
      },
      caps: {
        genPerTimeUnit: 3n,
        storagePrice: 4n,
        receiptPrice: 5n,
      },
      source: 'network-default' as const,
      verification: {
        status: 'verified' as const,
        expectedHash: `0x${'0'.repeat(64)}` as const,
        actualHash: `0x${'0'.repeat(64)}` as const,
      },
      refundable: true,
    } as const;
    const tx: SubmitInput = {
      kind: 'deploy',
      code: 'class Contract: pass',
      args: [],
    };

    const first = kit.verification(quote, tx);
    const second = kit.verification(quote, tx);

    expect(first.feeConfigHash).toBe(second.feeConfigHash);
    expect(first.feeConfigHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(first.summary.total).toBe('350');
  });
});
