// src/index.ts
import { AbiCoder, id, keccak256 } from "ethers";
import {
  createClient,
  isSuccessful as sdkIsSuccessful
} from "genlayer-js";
var abiCoder = AbiCoder.defaultAbiCoder();
var TRANSACTION_STATUS_NUMBER_TO_NAME = {
  "0": "UNINITIALIZED",
  "1": "PENDING",
  "2": "PROPOSING",
  "3": "COMMITTING",
  "4": "REVEALING",
  "5": "ACCEPTED",
  "6": "UNDETERMINED",
  "7": "FINALIZED",
  "8": "CANCELED",
  "9": "APPEAL_REVEALING",
  "10": "APPEAL_COMMITTING",
  "11": "READY_TO_FINALIZE",
  "12": "VALIDATORS_TIMEOUT",
  "13": "LEADER_TIMEOUT",
  "14": "LEADER_REVEALING"
};
var EXECUTION_RESULT_NUMBER_TO_NAME = {
  "0": "NOT_VOTED",
  "1": "FINISHED_WITH_RETURN",
  "2": "FINISHED_WITH_ERROR",
  "3": "TIMEOUT",
  "4": "NONDET_DISAGREE"
};
var PRESET_APPEAL_ROUNDS = {
  low: 1n,
  standard: 3n,
  high: 5n
};
var buildRotations = (appealRounds, rotationsPerRound) => (
  // one entry per leader round: the initial round plus each appeal round
  Array.from({ length: Number(appealRounds) + 1 }, () => rotationsPerRound)
);
var POLL_INTERVAL_MS = 2e3;
var MAX_POLLS = 300;
var toCalldataArgs = (args) => args;
var max = (value, floor) => value > floor ? value : floor;
var leaderRounds = (distribution) => distribution.rotations.reduce(
  (sum, rotations) => sum + rotations + 1n,
  distribution.appealRounds
);
var buildBreakdown = (estimate) => {
  const messageFees = estimate.distribution.totalMessageFees;
  const executionBudget = estimate.distribution.executionBudgetPerRound * leaderRounds(estimate.distribution);
  const timeUnitFees = max(estimate.feeValue - messageFees - executionBudget, 0n);
  return {
    timeUnitFees,
    executionBudget,
    messageFees
  };
};
var toPolicyQuote = (estimate, userValue, source) => ({
  ...estimate.policy?.enabled === false ? { gasless: true } : {},
  distribution: estimate.distribution,
  feeValue: estimate.feeValue,
  userValue,
  total: estimate.feeValue + userValue,
  source,
  breakdown: buildBreakdown(estimate),
  caps: {
    genPerTimeUnit: estimate.distribution.maxPriceGenPerTimeUnit,
    storagePrice: estimate.distribution.storageFeeMaxGasPrice,
    receiptPrice: estimate.distribution.receiptFeeMaxGasPrice
  },
  refundable: true
});
var resolveSuggestion = (suggestions, tx) => {
  if (!suggestions || !tx) return void 0;
  return tx.kind === "deploy" ? suggestions.deploy : suggestions.methods?.[tx.method];
};
var buildFeeOptions = (input, suggestion) => {
  const { rotationsPerRound, ...allocationSuggestion } = suggestion ?? {};
  const appealRounds = BigInt(
    input.overrides?.appealRounds ?? PRESET_APPEAL_ROUNDS[input.preset ?? "standard"]
  );
  const rotations = input.overrides?.rotations ?? buildRotations(appealRounds, BigInt(rotationsPerRound ?? 0));
  return {
    ...allocationSuggestion,
    ...input.overrides ?? {},
    appealRounds,
    rotations
  };
};
var QUEUES_SELECTOR = id("queues()").slice(0, 10);
var PENDING_COUNT_SELECTOR = id("getPendingTxCount(address)").slice(0, 10);
var ethCall = async (provider, to, data) => await provider.request({
  method: "eth_call",
  params: [{ to, data }, "latest"]
});
var readPendingAhead = async (provider, chain, recipient, cache) => {
  try {
    const consensusAddress = chain.consensusMainContract?.address;
    if (!consensusAddress) return void 0;
    if (!cache.queuesAddress) {
      const raw2 = await ethCall(provider, consensusAddress, QUEUES_SELECTOR);
      const [queuesAddress] = abiCoder.decode(["address"], raw2);
      cache.queuesAddress = queuesAddress;
    }
    const data = PENDING_COUNT_SELECTOR + abiCoder.encode(["address"], [recipient]).slice(2);
    const raw = await ethCall(provider, cache.queuesAddress, data);
    const [count] = abiCoder.decode(["uint256"], raw);
    return Number(count);
  } catch {
    return void 0;
  }
};
var captureProviderTxHash = (provider) => {
  let lastEvmTxHash;
  const wrapped = {
    async request(args) {
      const result = await provider.request(args);
      if (args.method === "eth_sendTransaction" && typeof result === "string" && result.startsWith("0x")) {
        lastEvmTxHash = result;
      }
      return result;
    }
  };
  return {
    provider: wrapped,
    getLastEvmTxHash: () => lastEvmTxHash
  };
};
var feeTuple = (fees) => [
  fees.leaderTimeunitsAllocation,
  fees.validatorTimeunitsAllocation,
  fees.appealRounds,
  fees.executionBudgetPerRound,
  fees.executionConsumed,
  fees.totalMessageFees,
  fees.rotations,
  fees.maxPriceGenPerTimeUnit,
  fees.storageFeeMaxGasPrice,
  fees.receiptFeeMaxGasPrice
];
var hashFeeConfig = (distribution) => keccak256(
  abiCoder.encode(
    [
      "tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256[],uint256,uint256,uint256)",
      "tuple(uint8,bool,uint256,address,bytes32,uint256,bytes)[]"
    ],
    [feeTuple(distribution), []]
  )
);
var asStringRecord = (quote, tx) => ({
  kind: tx.kind,
  feeValue: quote.feeValue.toString(),
  userValue: quote.userValue.toString(),
  total: quote.total.toString(),
  appealRounds: quote.distribution.appealRounds.toString(),
  rotations: quote.distribution.rotations.map(String).join(","),
  leaderTimeunitsAllocation: quote.distribution.leaderTimeunitsAllocation.toString(),
  validatorTimeunitsAllocation: quote.distribution.validatorTimeunitsAllocation.toString(),
  executionBudgetPerRound: quote.distribution.executionBudgetPerRound.toString(),
  totalMessageFees: quote.distribution.totalMessageFees.toString(),
  maxPriceGenPerTimeUnit: quote.distribution.maxPriceGenPerTimeUnit.toString(),
  storageFeeMaxGasPrice: quote.distribution.storageFeeMaxGasPrice.toString(),
  receiptFeeMaxGasPrice: quote.distribution.receiptFeeMaxGasPrice.toString()
});
var statusNameOf = (transaction) => {
  if (transaction.statusName) {
    return transaction.statusName;
  }
  if (typeof transaction.status === "string") {
    const status = transaction.status;
    return /^\d+$/u.test(status) ? TRANSACTION_STATUS_NUMBER_TO_NAME[status] : status;
  }
  if (typeof transaction.status === "number") {
    return TRANSACTION_STATUS_NUMBER_TO_NAME[String(transaction.status)];
  }
  return void 0;
};
var executionResultNameOf = (transaction) => {
  if (transaction.txExecutionResultName) {
    return transaction.txExecutionResultName;
  }
  if (transaction.txExecutionResult === void 0) {
    return void 0;
  }
  return EXECUTION_RESULT_NUMBER_TO_NAME[String(
    transaction.txExecutionResult
  )];
};
var isFinalized = (statusName) => statusName === "FINALIZED";
var isDecided = (statusName) => [
  "ACCEPTED",
  "UNDETERMINED",
  "FINALIZED",
  "CANCELED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT"
].includes(statusName ?? "");
var phaseOf = (transaction) => {
  const statusName = statusNameOf(transaction);
  if (isFinalized(statusName)) {
    return "finalized";
  }
  if (isDecided(statusName)) {
    return "decided";
  }
  if ([
    "PROPOSING",
    "COMMITTING",
    "REVEALING",
    "APPEAL_REVEALING",
    "APPEAL_COMMITTING",
    "LEADER_REVEALING",
    "READY_TO_FINALIZE"
  ].includes(statusName ?? "")) {
    return "processing";
  }
  return "pending";
};
var mapTrackedStatus = (genlayerTxId, transaction) => {
  const statusName = statusNameOf(transaction);
  const executionResultName = executionResultNameOf(transaction);
  const phase = phaseOf(transaction);
  const contractAddress = transaction.txDataDecoded?.contractAddress;
  const status = {
    phase,
    genlayerTxId: transaction.txId ?? transaction.hash ?? genlayerTxId
  };
  if (statusName !== void 0) {
    status.statusName = statusName;
  }
  if (executionResultName !== void 0) {
    status.executionResultName = executionResultName;
  }
  if (isDecided(statusName)) {
    status.successful = sdkIsSuccessful(transaction);
  }
  if (typeof contractAddress === "string" && contractAddress.startsWith("0x")) {
    status.contractAddress = contractAddress;
  }
  const queuePosition = transaction.queuePosition;
  if (queuePosition !== void 0 && (phase === "pending" || phase === "submitted")) {
    status.queuePosition = Number(queuePosition);
  }
  return status;
};
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
function createTransactionKit(opts) {
  const captured = captureProviderTxHash(opts.provider);
  const client = createClient({
    chain: opts.chain,
    provider: captured.provider,
    ...opts.account ? { account: opts.account } : {}
  });
  const queueCache = {};
  const estimate = async (input, tx) => {
    const userValue = input.userValue ?? 0n;
    const suggestion = resolveSuggestion(opts.suggestions, tx);
    const feeOptions = buildFeeOptions(input, suggestion);
    const [sdkEstimate, pendingAhead] = await Promise.all([
      client.estimateTransactionFees(feeOptions),
      // a deploy targets a fresh address, so its queue is necessarily empty
      tx?.kind === "write" ? readPendingAhead(opts.provider, opts.chain, tx.address, queueCache) : Promise.resolve(void 0)
    ]);
    const quote = toPolicyQuote(
      sdkEstimate,
      userValue,
      suggestion ? "developer" : "network-default"
    );
    if (pendingAhead !== void 0) {
      quote.queue = { pendingAhead };
    }
    return quote;
  };
  const submit = async (quote, tx) => {
    const common = {
      // a gasless network takes no deposit — sending fee params would at best
      // be ignored and at worst rejected, so omit them entirely
      ...quote.gasless ? {} : { fees: { distribution: quote.distribution, feeValue: quote.feeValue } },
      value: quote.userValue
    };
    const genlayerTxId = tx.kind === "deploy" ? await client.deployContract({
      ...common,
      code: tx.code,
      args: toCalldataArgs(tx.args),
      leaderOnly: tx.leaderOnly
    }) : await client.writeContract({
      ...common,
      address: tx.address,
      functionName: tx.method,
      args: toCalldataArgs(tx.args)
    });
    const result = {
      genlayerTxId
    };
    const evmTxHash = captured.getLastEvmTxHash();
    if (evmTxHash !== void 0) {
      result.evmTxHash = evmTxHash;
    }
    return result;
  };
  const track = async (genlayerTxId, onUpdate, opts2) => {
    const until = opts2?.until ?? "finalized";
    const submitted = {
      phase: "submitted",
      genlayerTxId
    };
    onUpdate(submitted);
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      const transaction = await client.getTransaction({ hash: genlayerTxId });
      const status = mapTrackedStatus(genlayerTxId, transaction);
      onUpdate(status);
      if (status.phase === "finalized" || until === "decided" && status.phase === "decided") {
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
    verification(quote, tx) {
      return {
        feeConfigHash: hashFeeConfig(quote.distribution),
        summary: asStringRecord(quote, tx)
      };
    }
  };
}
export {
  createTransactionKit
};
