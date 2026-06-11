import { AbiCoder, id, keccak256 } from 'ethers';
import {
  createClient,
  isSuccessful as sdkIsSuccessful,
} from 'genlayer-js';
import type {
  FeesDistribution,
  FeesDistributionInput,
  GenLayerChain,
  GenLayerTransaction,
  TransactionFeeEstimate,
} from 'genlayer-js/types';

export type {
  FeesDistribution,
  FeesDistributionInput,
  GenLayerChain,
} from 'genlayer-js/types';

export type FeePreset = 'low' | 'standard' | 'high';

export type PolicyInput = {
  preset?: FeePreset;
  overrides?: Partial<FeesDistributionInput>;
  userValue?: bigint;
};

/** Allocation params measured offline (e.g. from the contract's test suite,
 *  with headroom already applied). Values may be decimal strings so a JSON
 *  fee profile can be passed through unchanged. */
export type SuggestedFees = {
  leaderTimeunitsAllocation?: bigint | number | string;
  validatorTimeunitsAllocation?: bigint | number | string;
  executionBudgetPerRound?: bigint | number | string;
  totalMessageFees?: bigint | number | string;
  /** Rotations budgeted per leader round. Empirical per application — set it
   *  in the fee profile, not in user-facing UI. Defaults to 0. */
  rotationsPerRound?: bigint | number | string;
};

export type FeeSuggestions = {
  version?: number;
  network?: string;
  measuredAt?: string;
  deploy?: SuggestedFees;
  methods?: Record<string, SuggestedFees>;
};

export type PolicyQuote = {
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
  queue?: { pendingAhead: number };
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

export type SubmitInput =
  | { kind: 'deploy'; code: string; args?: unknown[]; leaderOnly?: boolean }
  | {
      kind: 'write';
      address: `0x${string}`;
      method: string;
      args?: unknown[];
    };

export type TrackedStatus = {
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

export type TransactionKit = {
  estimate(input: PolicyInput, tx?: SubmitInput): Promise<PolicyQuote>;
  submit(
    quote: PolicyQuote,
    tx: SubmitInput,
  ): Promise<{ genlayerTxId: `0x${string}`; evmTxHash?: `0x${string}` }>;
  track(
    genlayerTxId: `0x${string}`,
    onUpdate: (s: TrackedStatus) => void,
    opts?: { until?: 'decided' | 'finalized' },
  ): Promise<TrackedStatus>;
  verification(
    quote: PolicyQuote,
    tx: SubmitInput,
  ): { feeConfigHash: `0x${string}`; summary: Record<string, string> };
};

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type Client = {
  estimateTransactionFees: (
    args?: Record<string, unknown>,
  ) => Promise<TransactionFeeEstimate>;
  writeContract(args: Record<string, unknown>): Promise<`0x${string}`>;
  deployContract(args: Record<string, unknown>): Promise<`0x${string}`>;
  getTransaction(args: { hash: `0x${string}` }): Promise<GenLayerTransaction>;
  waitForTransactionReceipt?: (args: {
    hash: `0x${string}`;
    waitUntil?: 'decided' | 'finalized';
    fullTransaction?: boolean;
  }) => Promise<GenLayerTransaction>;
};

const abiCoder = AbiCoder.defaultAbiCoder();

const TRANSACTION_STATUS_NUMBER_TO_NAME = {
  '0': 'UNINITIALIZED',
  '1': 'PENDING',
  '2': 'PROPOSING',
  '3': 'COMMITTING',
  '4': 'REVEALING',
  '5': 'ACCEPTED',
  '6': 'UNDETERMINED',
  '7': 'FINALIZED',
  '8': 'CANCELED',
  '9': 'APPEAL_REVEALING',
  '10': 'APPEAL_COMMITTING',
  '11': 'READY_TO_FINALIZE',
  '12': 'VALIDATORS_TIMEOUT',
  '13': 'LEADER_TIMEOUT',
  '14': 'LEADER_REVEALING',
} as const;

const EXECUTION_RESULT_NUMBER_TO_NAME = {
  '0': 'NOT_VOTED',
  '1': 'FINISHED_WITH_RETURN',
  '2': 'FINISHED_WITH_ERROR',
  '3': 'TIMEOUT',
  '4': 'NONDET_DISAGREE',
} as const;

// Presets buy appeal posture only — how many appeal rounds the deposit can
// fund. Rotations are not a user choice: they're empirical per application
// and come from the developer fee profile (rotationsPerRound), defaulting
// to 0. Callers can exceed the presets via overrides.appealRounds.
const PRESET_APPEAL_ROUNDS: Record<FeePreset, bigint> = {
  low: 1n,
  standard: 3n,
  high: 5n,
};

const buildRotations = (
  appealRounds: bigint,
  rotationsPerRound: bigint,
): bigint[] =>
  // one entry per leader round: the initial round plus each appeal round
  Array.from({ length: Number(appealRounds) + 1 }, () => rotationsPerRound);

const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 300;

const toCalldataArgs = (args: unknown[] | undefined): unknown[] | undefined =>
  args;

const max = (value: bigint, floor: bigint): bigint =>
  value > floor ? value : floor;

const leaderRounds = (distribution: FeesDistribution): bigint =>
  distribution.rotations.reduce(
    (sum, rotations) => sum + rotations + 1n,
    distribution.appealRounds,
  );

const buildBreakdown = (
  estimate: TransactionFeeEstimate,
): PolicyQuote['breakdown'] => {
  const messageFees = estimate.distribution.totalMessageFees;
  const executionBudget =
    estimate.distribution.executionBudgetPerRound *
    leaderRounds(estimate.distribution);
  const timeUnitFees = max(estimate.feeValue - messageFees - executionBudget, 0n);

  return {
    timeUnitFees,
    executionBudget,
    messageFees,
  };
};

const toPolicyQuote = (
  estimate: TransactionFeeEstimate,
  userValue: bigint,
  source: PolicyQuote['source'],
): PolicyQuote => ({
  ...(estimate.policy?.enabled === false ? { gasless: true } : {}),
  distribution: estimate.distribution,
  feeValue: estimate.feeValue,
  userValue,
  total: estimate.feeValue + userValue,
  source,
  breakdown: buildBreakdown(estimate),
  caps: {
    genPerTimeUnit: estimate.distribution.maxPriceGenPerTimeUnit,
    storagePrice: estimate.distribution.storageFeeMaxGasPrice,
    receiptPrice: estimate.distribution.receiptFeeMaxGasPrice,
  },
  refundable: true,
});

const resolveSuggestion = (
  suggestions: FeeSuggestions | undefined,
  tx: SubmitInput | undefined,
): SuggestedFees | undefined => {
  if (!suggestions || !tx) return undefined;
  return tx.kind === 'deploy'
    ? suggestions.deploy
    : suggestions.methods?.[tx.method];
};

// Merge order: preset (appeal posture) < developer suggestion (measured
// allocations) < caller overrides. Prices/caps stay unset so the SDK fills
// them from live reads with headroom — never from the profile.
const buildFeeOptions = (
  input: PolicyInput,
  suggestion?: SuggestedFees,
): Record<string, unknown> => {
  const { rotationsPerRound, ...allocationSuggestion } = suggestion ?? {};
  const appealRounds = BigInt(
    (input.overrides?.appealRounds ??
      PRESET_APPEAL_ROUNDS[input.preset ?? 'standard']) as bigint,
  );
  const rotations =
    input.overrides?.rotations ??
    buildRotations(appealRounds, BigInt(rotationsPerRound ?? 0));

  return {
    ...allocationSuggestion,
    ...(input.overrides ?? {}),
    appealRounds,
    rotations,
  };
};

const QUEUES_SELECTOR = id('queues()').slice(0, 10);
const PENDING_COUNT_SELECTOR = id('getPendingTxCount(address)').slice(0, 10);

const ethCall = async (
  provider: Eip1193Provider,
  to: string,
  data: string,
): Promise<string> =>
  (await provider.request({
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  })) as string;

/** Pending-queue depth for a recipient, via the consensus contracts over the
 *  RPC passthrough: ConsensusMain.queues() -> Queues.getPendingTxCount().
 *  Returns undefined when the chain config lacks the consensus contract or
 *  any read fails — queue depth is advisory, never blocks the estimate. */
const readPendingAhead = async (
  provider: Eip1193Provider,
  chain: GenLayerChain,
  recipient: string,
  cache: { queuesAddress?: string },
): Promise<number | undefined> => {
  try {
    const consensusAddress = (
      chain as { consensusMainContract?: { address?: string } }
    ).consensusMainContract?.address;
    if (!consensusAddress) return undefined;

    if (!cache.queuesAddress) {
      const raw = await ethCall(provider, consensusAddress, QUEUES_SELECTOR);
      const [queuesAddress] = abiCoder.decode(['address'], raw);
      cache.queuesAddress = queuesAddress as string;
    }
    const data =
      PENDING_COUNT_SELECTOR +
      abiCoder.encode(['address'], [recipient]).slice(2);
    const raw = await ethCall(provider, cache.queuesAddress, data);
    const [count] = abiCoder.decode(['uint256'], raw);
    return Number(count);
  } catch {
    return undefined;
  }
};

const captureProviderTxHash = (provider: Eip1193Provider) => {
  let lastEvmTxHash: `0x${string}` | undefined;
  const wrapped: Eip1193Provider = {
    async request(args) {
      const result = await provider.request(args);
      if (
        args.method === 'eth_sendTransaction' &&
        typeof result === 'string' &&
        result.startsWith('0x')
      ) {
        lastEvmTxHash = result as `0x${string}`;
      }
      return result;
    },
  };

  return {
    provider: wrapped,
    getLastEvmTxHash: () => lastEvmTxHash,
  };
};

const feeTuple = (fees: FeesDistribution): unknown[] => [
  fees.leaderTimeunitsAllocation,
  fees.validatorTimeunitsAllocation,
  fees.appealRounds,
  fees.executionBudgetPerRound,
  fees.executionConsumed,
  fees.totalMessageFees,
  fees.rotations,
  fees.maxPriceGenPerTimeUnit,
  fees.storageFeeMaxGasPrice,
  fees.receiptFeeMaxGasPrice,
];

const hashFeeConfig = (distribution: FeesDistribution): `0x${string}` =>
  keccak256(
    abiCoder.encode(
      [
        'tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256[],uint256,uint256,uint256)',
        'tuple(uint8,bool,uint256,address,bytes32,uint256,bytes)[]',
      ],
      [feeTuple(distribution), []],
    ),
  ) as `0x${string}`;

const asStringRecord = (quote: PolicyQuote, tx: SubmitInput) => ({
  kind: tx.kind,
  feeValue: quote.feeValue.toString(),
  userValue: quote.userValue.toString(),
  total: quote.total.toString(),
  appealRounds: quote.distribution.appealRounds.toString(),
  rotations: quote.distribution.rotations.map(String).join(','),
  leaderTimeunitsAllocation:
    quote.distribution.leaderTimeunitsAllocation.toString(),
  validatorTimeunitsAllocation:
    quote.distribution.validatorTimeunitsAllocation.toString(),
  executionBudgetPerRound:
    quote.distribution.executionBudgetPerRound.toString(),
  totalMessageFees: quote.distribution.totalMessageFees.toString(),
  maxPriceGenPerTimeUnit:
    quote.distribution.maxPriceGenPerTimeUnit.toString(),
  storageFeeMaxGasPrice:
    quote.distribution.storageFeeMaxGasPrice.toString(),
  receiptFeeMaxGasPrice:
    quote.distribution.receiptFeeMaxGasPrice.toString(),
});

const statusNameOf = (transaction: GenLayerTransaction): string | undefined => {
  if (transaction.statusName) {
    return transaction.statusName;
  }
  if (typeof transaction.status === 'string') {
    const status = transaction.status as string;
    return /^\d+$/u.test(status)
      ? TRANSACTION_STATUS_NUMBER_TO_NAME[
          status as keyof typeof TRANSACTION_STATUS_NUMBER_TO_NAME
        ]
      : status;
  }
  if (typeof transaction.status === 'number') {
    return TRANSACTION_STATUS_NUMBER_TO_NAME[
      String(transaction.status) as keyof typeof TRANSACTION_STATUS_NUMBER_TO_NAME
    ];
  }
  return undefined;
};

const executionResultNameOf = (
  transaction: GenLayerTransaction,
): string | undefined => {
  if (transaction.txExecutionResultName) {
    return transaction.txExecutionResultName;
  }
  if (transaction.txExecutionResult === undefined) {
    return undefined;
  }
  return EXECUTION_RESULT_NUMBER_TO_NAME[
    String(
      transaction.txExecutionResult,
    ) as keyof typeof EXECUTION_RESULT_NUMBER_TO_NAME
  ];
};

const isFinalized = (statusName: string | undefined): boolean =>
  statusName === 'FINALIZED';

const isDecided = (statusName: string | undefined): boolean =>
  [
    'ACCEPTED',
    'UNDETERMINED',
    'FINALIZED',
    'CANCELED',
    'LEADER_TIMEOUT',
    'VALIDATORS_TIMEOUT',
  ].includes(statusName ?? '');

const phaseOf = (
  transaction: GenLayerTransaction,
): TrackedStatus['phase'] => {
  const statusName = statusNameOf(transaction);
  if (isFinalized(statusName)) {
    return 'finalized';
  }
  if (isDecided(statusName)) {
    return 'decided';
  }
  if (
    [
      'PROPOSING',
      'COMMITTING',
      'REVEALING',
      'APPEAL_REVEALING',
      'APPEAL_COMMITTING',
      'LEADER_REVEALING',
      'READY_TO_FINALIZE',
    ].includes(statusName ?? '')
  ) {
    return 'processing';
  }
  return 'pending';
};

const mapTrackedStatus = (
  genlayerTxId: `0x${string}`,
  transaction: GenLayerTransaction,
): TrackedStatus => {
  const statusName = statusNameOf(transaction);
  const executionResultName = executionResultNameOf(transaction);
  const phase = phaseOf(transaction);
  const contractAddress = (transaction.txDataDecoded as Record<string, unknown>)
    ?.contractAddress;

  const status: TrackedStatus = {
    phase,
    genlayerTxId: transaction.txId ?? transaction.hash ?? genlayerTxId,
  };

  if (statusName !== undefined) {
    status.statusName = statusName;
  }
  if (executionResultName !== undefined) {
    status.executionResultName = executionResultName;
  }
  if (isDecided(statusName)) {
    status.successful = sdkIsSuccessful(transaction);
  }
  if (typeof contractAddress === 'string' && contractAddress.startsWith('0x')) {
    status.contractAddress = contractAddress as `0x${string}`;
  }
  const queuePosition = (transaction as { queuePosition?: bigint | string })
    .queuePosition;
  if (
    queuePosition !== undefined &&
    (phase === 'pending' || phase === 'submitted')
  ) {
    status.queuePosition = Number(queuePosition);
  }

  return status;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createTransactionKit(opts: {
  chain: GenLayerChain;
  provider: Eip1193Provider;
  account?: `0x${string}`;
  /** Developer fee profile (allocations measured by the contract's test
   *  suite). When a suggestion matches the transaction, it seeds the
   *  estimate; the panel never simulates the call live. */
  suggestions?: FeeSuggestions;
}): TransactionKit {
  const captured = captureProviderTxHash(opts.provider);
  const client = createClient({
    chain: opts.chain,
    provider: captured.provider,
    ...(opts.account ? { account: opts.account } : {}),
  } as never) as unknown as Client;

  const queueCache: { queuesAddress?: string } = {};

  const estimate = async (
    input: PolicyInput,
    tx?: SubmitInput,
  ): Promise<PolicyQuote> => {
    const userValue = input.userValue ?? 0n;
    const suggestion = resolveSuggestion(opts.suggestions, tx);
    const feeOptions = buildFeeOptions(input, suggestion);
    const [sdkEstimate, pendingAhead] = await Promise.all([
      client.estimateTransactionFees(feeOptions),
      // a deploy targets a fresh address, so its queue is necessarily empty
      tx?.kind === 'write'
        ? readPendingAhead(opts.provider, opts.chain, tx.address, queueCache)
        : Promise.resolve(undefined),
    ]);

    const quote = toPolicyQuote(
      sdkEstimate,
      userValue,
      suggestion ? 'developer' : 'network-default',
    );
    if (pendingAhead !== undefined) {
      quote.queue = { pendingAhead };
    }
    return quote;
  };

  const submit = async (
    quote: PolicyQuote,
    tx: SubmitInput,
  ): Promise<{ genlayerTxId: `0x${string}`; evmTxHash?: `0x${string}` }> => {
    const common = {
      // a gasless network takes no deposit — sending fee params would at best
      // be ignored and at worst rejected, so omit them entirely
      ...(quote.gasless
        ? {}
        : { fees: { distribution: quote.distribution, feeValue: quote.feeValue } }),
      value: quote.userValue,
    };
    const genlayerTxId =
      tx.kind === 'deploy'
        ? await client.deployContract({
            ...common,
            code: tx.code,
            args: toCalldataArgs(tx.args),
            leaderOnly: tx.leaderOnly,
          })
        : await client.writeContract({
            ...common,
            address: tx.address,
            functionName: tx.method,
            args: toCalldataArgs(tx.args),
          });

    const result: { genlayerTxId: `0x${string}`; evmTxHash?: `0x${string}` } = {
      genlayerTxId,
    };
    const evmTxHash = captured.getLastEvmTxHash();
    if (evmTxHash !== undefined) {
      result.evmTxHash = evmTxHash;
    }
    return result;
  };

  const track = async (
    genlayerTxId: `0x${string}`,
    onUpdate: (s: TrackedStatus) => void,
    opts?: { until?: 'decided' | 'finalized' },
  ): Promise<TrackedStatus> => {
    const until = opts?.until ?? 'finalized';
    const submitted: TrackedStatus = {
      phase: 'submitted',
      genlayerTxId,
    };
    onUpdate(submitted);

    for (let poll = 0; poll < MAX_POLLS; poll++) {
      const transaction = await client.getTransaction({ hash: genlayerTxId });
      const status = mapTrackedStatus(genlayerTxId, transaction);
      onUpdate(status);

      if (
        status.phase === 'finalized' ||
        (until === 'decided' && status.phase === 'decided')
      ) {
        return status;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out tracking GenLayer transaction ${genlayerTxId}`);
  };

  return {
    estimate,
    submit,
    track,
    verification(quote: PolicyQuote, tx: SubmitInput) {
      return {
        feeConfigHash: hashFeeConfig(quote.distribution),
        summary: asStringRecord(quote, tx),
      };
    },
  };
}
