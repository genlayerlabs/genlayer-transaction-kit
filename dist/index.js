// src/format.ts
var WEI = 10n ** 18n;
function splitGen(wei) {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = (abs / WEI).toString();
  const fraction = (abs % WEI).toString().padStart(18, "0");
  return { whole: negative ? `-${whole}` : whole, fraction };
}
function formatGen(wei) {
  if (wei === 0n) return "0";
  const { whole, fraction } = splitGen(wei);
  if (fraction === "0".repeat(18)) return whole;
  const firstSignificant = fraction.search(/[1-9]/u);
  const keep = Math.min(18, Math.max(4, firstSignificant + 4));
  const trimmed = fraction.slice(0, keep).replace(/0+$/u, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}
function groupDigits(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, "\u2009");
}
function formatWei(wei) {
  return `${groupDigits(wei.toString())} wei`;
}
function shortHash(hash, head = 10, tail = 6) {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}\u2026${hash.slice(-tail)}`;
}
var ERROR_COPY = [
  [
    /InsufficientFees/iu,
    "Deposit too small",
    "The attached deposit does not cover the quoted fees. Nothing was charged \u2014 re-estimate and try again."
  ],
  [
    /MaxPriceExceeded/iu,
    "Price moved above your cap",
    "The network price rose past the maximum you authorized. Nothing was charged. Re-estimate to quote at the current price."
  ],
  [
    /BudgetTooLow|RollupBudgetBelowFloor/iu,
    "Execution budget below the network minimum",
    "The per-round execution budget cannot fit even the smallest receipt. Increase the budget and resubmit."
  ],
  [
    /FeeValueMustBeNonZero/iu,
    "Incomplete fee configuration",
    "Every fee field and price cap must be set above zero. This is usually a client bug \u2014 re-estimate to rebuild the policy."
  ],
  [
    /ExecutionBudgetExceeded/iu,
    "Execution budget exhausted",
    "The transaction consumed more storage and receipt budget than you allocated. Unused funds are refunded; increase the budget and retry."
  ],
  [
    /MessageBudgetExceeded|MessageDeclaredBudgetInsufficient/iu,
    "Message budget exhausted",
    "The messages this transaction emits need more budget than was reserved. Increase the message bucket and retry."
  ],
  [
    /AppealBondTooLow|InvalidAppealBond/iu,
    "Appeal bond below the minimum",
    "The appeal bond does not meet the required minimum for this round."
  ],
  [
    /user rejected|denied|4001/iu,
    "Signature declined",
    "The request was declined in your wallet. Nothing was submitted."
  ]
];
function describeError(raw) {
  for (const [pattern, title, detail] of ERROR_COPY) {
    if (pattern.test(raw)) return { title, detail, raw };
  }
  return {
    title: "Transaction failed",
    detail: "The transaction could not be completed. The raw error is below.",
    raw
  };
}
function describeOutcome(statusName, executionResultName) {
  const status = (statusName ?? "").toUpperCase();
  const result = (executionResultName ?? "").toUpperCase();
  if ((status === "ACCEPTED" || status === "FINALIZED") && result === "FINISHED_WITH_RETURN") {
    return {
      tone: "success",
      title: status === "FINALIZED" ? "Finalized" : "Accepted",
      detail: "Validators agreed and the execution succeeded."
    };
  }
  if (status === "UNDETERMINED") {
    return {
      tone: "warn",
      title: "Undetermined",
      detail: "Validators could not reach a majority. The leader produced a result, but it was not confirmed \u2014 treat this transaction as not executed."
    };
  }
  if (result === "FINISHED_WITH_ERROR") {
    return {
      tone: "error",
      title: "Execution failed",
      detail: "Consensus accepted the transaction, but the contract execution ended in an error. You pay only for the work performed; the rest is refunded."
    };
  }
  if (status === "LEADER_TIMEOUT" || status === "VALIDATORS_TIMEOUT") {
    return {
      tone: "warn",
      title: status === "LEADER_TIMEOUT" ? "Leader timed out" : "Validators timed out",
      detail: "The round timed out before completion. Unused fees are refunded at finalization."
    };
  }
  if (status === "CANCELED") {
    return {
      tone: "error",
      title: "Canceled",
      detail: "The transaction was canceled before execution. Fees were refunded."
    };
  }
  return {
    tone: "warn",
    title: status || "Unknown outcome",
    detail: "The transaction reached a terminal state that could not be classified."
  };
}

// src/useTransactionFlow.ts
import { computed, ref, shallowRef, watch } from "vue";
function useTransactionFlow(opts) {
  const { kit, tx, userValue, trackUntil = "decided" } = opts;
  const preset = ref("standard");
  const overrides = shallowRef(void 0);
  const state = shallowRef({ step: "estimating", preset: "standard" });
  let generation = 0;
  async function estimate() {
    const gen = ++generation;
    state.value = { step: "estimating", preset: preset.value };
    try {
      const quote2 = await kit.estimate(
        { preset: preset.value, overrides: overrides.value, userValue },
        tx
      );
      if (generation !== gen) return;
      state.value = { step: "review", preset: preset.value, quote: quote2 };
    } catch (error) {
      if (generation !== gen) return;
      state.value = {
        step: "error",
        preset: preset.value,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  watch([preset, overrides], () => void estimate(), { immediate: true });
  const quote = computed(() => "quote" in state.value ? state.value.quote : void 0);
  const verification = computed(() => {
    const current = quote.value;
    if (!current) return void 0;
    try {
      return kit.verification(current, tx);
    } catch {
      return void 0;
    }
  });
  async function approve() {
    const current = state.value;
    if (current.step !== "review") return;
    const approvedQuote = current.quote;
    state.value = { step: "signing", preset: preset.value, quote: approvedQuote };
    try {
      const { genlayerTxId, evmTxHash } = await kit.submit(approvedQuote, tx);
      let last = { phase: "submitted", genlayerTxId, evmTxHash };
      state.value = { step: "tracking", preset: preset.value, quote: approvedQuote, status: last };
      last = await kit.track(
        genlayerTxId,
        (status) => {
          last = { evmTxHash, ...status };
          state.value = {
            step: "tracking",
            preset: preset.value,
            quote: approvedQuote,
            status: last
          };
        },
        { until: trackUntil }
      );
      state.value = {
        step: "done",
        preset: preset.value,
        quote: approvedQuote,
        status: { evmTxHash, ...last }
      };
    } catch (error) {
      state.value = {
        step: "error",
        preset: preset.value,
        quote: approvedQuote,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  return {
    state,
    preset,
    overrides,
    quote,
    verification,
    approve,
    reset: () => void estimate()
  };
}

// src/components.ts
import {
  computed as computed2,
  defineComponent,
  h,
  ref as ref2,
  watch as watch2
} from "vue";
var PRESET_COPY = {
  low: { label: "Low", sub: "1 appeal round" },
  standard: { label: "Standard", sub: "3 appeal rounds" },
  high: { label: "High", sub: "5 appeal rounds" }
};
function genValue(wei, busy) {
  return h("span", { class: "gltk-total-value", "data-busy": busy ? "true" : void 0 }, [
    formatGen(wei),
    h("span", { class: "gltk-unit" }, "GEN")
  ]);
}
function receiptRow(label, wei, hint) {
  return h("div", { class: "gltk-row" }, [
    h("span", { class: "gltk-row-label" }, [
      label,
      hint ? h("span", { class: "gltk-row-hint" }, hint) : null
    ]),
    h("span", { class: "gltk-row-value" }, [formatGen(wei), h("span", { class: "gltk-unit" }, "GEN")])
  ]);
}
var FeeReceipt = defineComponent({
  name: "GltkFeeReceipt",
  props: {
    quote: { type: Object, required: true },
    busy: { type: Boolean, default: false }
  },
  setup(props) {
    return () => h("div", { class: "gltk-receipt" }, [
      receiptRow("Consensus work", props.quote.breakdown.timeUnitFees, "leader + validators, per round"),
      receiptRow("Execution budget", props.quote.breakdown.executionBudget, "storage + receipt writes"),
      props.quote.breakdown.messageFees > 0n ? receiptRow("Message budget", props.quote.breakdown.messageFees, "child transactions") : null,
      props.quote.userValue > 0n ? receiptRow("Value sent", props.quote.userValue, "delivered to the contract") : null,
      h("div", { class: "gltk-total" }, [
        h("span", { class: "gltk-total-label" }, "Total deposit"),
        genValue(props.quote.total, props.busy)
      ]),
      h(
        "p",
        { class: "gltk-refundable" },
        "Unused amounts are refunded when the transaction finalizes."
      ),
      h(
        "p",
        { class: "gltk-source", "data-source": props.quote.source },
        `${props.quote.source === "developer" ? "Sized from the developer\u2019s measured fee profile" : "Sized from network defaults"} \xB7 live prices, never simulated`
      )
    ]);
  }
});
var PresetSelector = defineComponent({
  name: "GltkPresetSelector",
  props: {
    modelValue: { type: String, required: true },
    disabled: { type: Boolean, default: false }
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () => h(
      "div",
      { class: "gltk-presets", role: "radiogroup", "aria-label": "Fee preset" },
      Object.keys(PRESET_COPY).map(
        (preset) => h(
          "button",
          {
            key: preset,
            type: "button",
            role: "radio",
            class: "gltk-preset",
            "aria-checked": props.modelValue === preset,
            "data-active": props.modelValue === preset ? "true" : void 0,
            disabled: props.disabled,
            onClick: () => emit("update:modelValue", preset)
          },
          [PRESET_COPY[preset].label, h("small", PRESET_COPY[preset].sub)]
        )
      )
    );
  }
});
var CapsShield = defineComponent({
  name: "GltkCapsShield",
  props: { quote: { type: Object, required: true } },
  setup(props) {
    return () => h("div", { class: "gltk-caps" }, [
      h("div", { class: "gltk-caps-title" }, "Price protection"),
      h("div", { class: "gltk-caps-grid" }, [
        h("span", { class: "gltk-cap" }, [
          "Time-unit price cap ",
          h("b", `${formatGen(props.quote.caps.genPerTimeUnit)} GEN`)
        ]),
        h("span", { class: "gltk-cap" }, [
          "Storage price cap ",
          h("b", `${props.quote.caps.storagePrice.toString()} wei`)
        ]),
        h("span", { class: "gltk-cap" }, [
          "Receipt gas cap ",
          h("b", `${props.quote.caps.receiptPrice.toString()} wei`)
        ])
      ]),
      h(
        "p",
        { class: "gltk-caps-note" },
        "If network prices rise above any cap, the transaction is rejected and nothing is charged."
      )
    ]);
  }
});
var HoldToSign = defineComponent({
  name: "GltkHoldToSign",
  props: {
    disabled: { type: Boolean, default: false },
    holdMs: { type: Number, default: 900 },
    label: { type: String, default: "Approve & sign" }
  },
  emits: ["confirm"],
  setup(props, { emit }) {
    const holding = ref2(false);
    let timer;
    let touchHandled = false;
    const start = (event) => {
      if (props.disabled || event.pointerType === "mouse") return;
      touchHandled = true;
      holding.value = true;
      timer = setTimeout(() => {
        holding.value = false;
        emit("confirm");
      }, props.holdMs);
    };
    const cancel = () => {
      holding.value = false;
      if (timer) clearTimeout(timer);
    };
    return () => h(
      "button",
      {
        type: "button",
        class: "gltk-hold",
        style: { "--gltk-hold-ms": `${props.holdMs}ms` },
        "data-holding": holding.value ? "true" : void 0,
        disabled: props.disabled,
        onPointerdown: start,
        onPointerup: cancel,
        onPointerleave: cancel,
        onClick: () => {
          if (props.disabled) return;
          if (touchHandled) {
            touchHandled = false;
            return;
          }
          emit("confirm");
        }
      },
      [
        h("span", { class: "gltk-hold-fill", "aria-hidden": "true" }),
        props.label,
        h("span", { class: "gltk-hold-hint" }, "hold to confirm")
      ]
    );
  }
});
var PHASES = [
  { key: "submitted", label: "Submitted to the chain" },
  { key: "processing", label: "Consensus in progress" },
  { key: "decided", label: "Decided" },
  { key: "finalized", label: "Finalized" }
];
var Timeline = defineComponent({
  name: "GltkTimeline",
  props: { status: { type: Object, required: true } },
  setup(props) {
    return () => {
      const order = [
        "submitted",
        "pending",
        "processing",
        "decided",
        "finalized"
      ];
      const current = order.indexOf(props.status.phase);
      const outcome = describeOutcome(props.status.statusName, props.status.executionResultName);
      return h(
        "div",
        { class: "gltk-timeline", "aria-live": "polite" },
        PHASES.map((phase) => {
          const phasePos = order.indexOf(phase.key);
          const state = phasePos < current ? "done" : phasePos === current ? "active" : "idle";
          const isOutcomeNode = phase.key === "decided" && phasePos <= current;
          return h(
            "div",
            {
              key: phase.key,
              class: "gltk-node",
              "data-state": state,
              "data-tone": isOutcomeNode && outcome.tone !== "success" ? outcome.tone : void 0
            },
            [
              h("span", { class: "gltk-node-rail" }, [
                h("span", { class: "gltk-node-dot" }),
                h("span", { class: "gltk-node-line" })
              ]),
              h("span", { class: "gltk-node-label" }, [
                isOutcomeNode ? `Decided \u2014 ${outcome.title}` : phase.label,
                phase.key === "submitted" && props.status.genlayerTxId ? h("span", { class: "gltk-node-sub" }, [
                  "tx ",
                  h("code", shortHash(props.status.genlayerTxId))
                ]) : null,
                phase.key === "submitted" && props.status.queuePosition !== void 0 && current <= order.indexOf("pending") ? h(
                  "span",
                  { class: "gltk-node-sub" },
                  props.status.queuePosition === 0 ? "next in queue" : `${props.status.queuePosition} ahead in queue`
                ) : null,
                phase.key === "decided" && isOutcomeNode && outcome.tone === "success" && props.status.contractAddress ? h("span", { class: "gltk-node-sub" }, [
                  "contract ",
                  h("code", shortHash(props.status.contractAddress))
                ]) : null
              ])
            ]
          );
        })
      );
    };
  }
});
function outcomeSurface(status) {
  const outcome = describeOutcome(status.statusName, status.executionResultName);
  return h("div", { class: "gltk-outcome", "data-tone": outcome.tone }, [
    h("p", { class: "gltk-outcome-title" }, outcome.title),
    h("p", { class: "gltk-outcome-detail" }, outcome.detail)
  ]);
}
var GenLayerTransactionPanel = defineComponent({
  name: "GenLayerTransactionPanel",
  props: {
    kit: { type: Object, required: true },
    tx: { type: Object, required: true },
    userValue: { type: BigInt, default: void 0 },
    network: { type: String, default: void 0 },
    theme: { type: String, default: "light" },
    trackUntil: { type: String, default: "decided" },
    snapState: { type: String, default: void 0 }
  },
  emits: ["done"],
  setup(props, { emit }) {
    const flow = useTransactionFlow({
      kit: props.kit,
      tx: props.tx,
      userValue: props.userValue,
      trackUntil: props.trackUntil
    });
    let doneEmitted = false;
    watch2(flow.state, (state) => {
      if (state.step === "done" && !doneEmitted) {
        doneEmitted = true;
        emit("done", state.status);
      }
    });
    const target = computed2(
      () => props.tx.kind === "deploy" ? { kind: "Deploy", what: "New intelligent contract" } : { kind: "Write", what: `${props.tx.method}() \xB7 ${shortHash(props.tx.address)}` }
    );
    return () => {
      const state = flow.state.value;
      const busy = state.step === "estimating";
      const reviewing = state.step === "review" || busy;
      const children = [
        h("div", { class: "gltk-head" }, [
          h("span", { class: "gltk-head-title" }, "GenLayer transaction"),
          props.network ? h("span", { class: "gltk-head-network" }, props.network) : null
        ]),
        h("div", { class: "gltk-target" }, [
          h("span", { class: "gltk-target-kind" }, target.value.kind),
          h("span", { class: "gltk-target-what" }, target.value.what)
        ])
      ];
      if (reviewing && flow.quote.value?.gasless) {
        const quote = flow.quote.value;
        children.push(
          h("div", { class: "gltk-gasless" }, [
            h("p", { class: "gltk-gasless-title" }, "No fees on this network"),
            h(
              "p",
              { class: "gltk-gasless-detail" },
              "Fee accounting is disabled here \u2014 no deposit is taken and nothing is charged."
            )
          ])
        );
        if (quote.userValue > 0n) {
          children.push(h(FeeReceipt, { quote, busy }));
        }
        children.push(
          h("div", { class: "gltk-actions" }, [
            h(HoldToSign, {
              disabled: busy,
              onConfirm: () => void flow.approve()
            })
          ])
        );
      } else if (reviewing) {
        children.push(
          h(PresetSelector, {
            modelValue: flow.preset.value,
            disabled: busy,
            "onUpdate:modelValue": (preset) => {
              flow.preset.value = preset;
            }
          })
        );
        children.push(
          h("details", { class: "gltk-advanced" }, [
            h("summary", "Advanced"),
            h("div", { class: "gltk-advanced-grid" }, [
              h("label", { class: "gltk-field" }, [
                h("span", "Appeal rounds"),
                h("input", {
                  type: "number",
                  min: 1,
                  placeholder: "preset",
                  disabled: busy,
                  onChange: (event) => {
                    const raw = event.target.value.trim();
                    const parsed = raw === "" ? void 0 : Number(raw);
                    if (parsed !== void 0 && Number.isInteger(parsed) && parsed >= 1) {
                      flow.overrides.value = {
                        ...flow.overrides.value ?? {},
                        appealRounds: BigInt(parsed)
                      };
                    } else {
                      const rest = { ...flow.overrides.value ?? {} };
                      delete rest.appealRounds;
                      flow.overrides.value = Object.keys(rest).length ? rest : void 0;
                    }
                  }
                })
              ])
            ])
          ])
        );
        const quote = flow.quote.value;
        if (quote) {
          children.push(h(FeeReceipt, { quote, busy }));
          children.push(h(CapsShield, { quote }));
          if (quote.queue) {
            const ahead = quote.queue.pendingAhead;
            children.push(
              h(
                "p",
                { class: "gltk-queue", "data-clear": ahead === 0 ? "true" : void 0 },
                ahead === 0 ? "Queue is clear \u2014 starts immediately" : `${ahead} transaction${ahead === 1 ? "" : "s"} queued ahead for this contract`
              )
            );
          }
          const verification = flow.verification.value;
          if (verification) {
            children.push(
              h(
                "div",
                {
                  class: "gltk-verify",
                  "data-state": props.snapState === "verified" ? "verified" : void 0
                },
                [
                  h(
                    "span",
                    props.snapState === "verified" ? "\u2713 Verified by GenLayer Snap" : "Policy fingerprint"
                  ),
                  h("code", shortHash(verification.feeConfigHash, 10, 6))
                ]
              )
            );
          }
        }
        children.push(
          h("div", { class: "gltk-actions" }, [
            h(HoldToSign, {
              disabled: busy || !flow.quote.value,
              onConfirm: () => void flow.approve()
            })
          ])
        );
      }
      if (state.step === "signing") {
        children.push(
          h(FeeReceipt, { quote: state.quote }),
          h("div", { class: "gltk-outcome", "data-tone": "warn" }, [
            h("p", { class: "gltk-outcome-title" }, "Waiting for your wallet"),
            h("p", { class: "gltk-outcome-detail" }, "Confirm the transaction in your wallet to continue.")
          ]),
          h("div", { class: "gltk-actions" })
        );
      }
      if (state.step === "tracking" || state.step === "done") {
        children.push(h(Timeline, { status: state.status }));
        if (state.step === "done") {
          children.push(outcomeSurface(state.status));
          children.push(
            h("div", { class: "gltk-actions" }, [
              h("div", { class: "gltk-link-row" }, [
                h("button", { type: "button", onClick: () => flow.reset() }, "New transaction")
              ])
            ])
          );
        }
      }
      if (state.step === "error") {
        const error = describeError(state.message);
        children.push(
          h("div", { class: "gltk-outcome", "data-tone": "error" }, [
            h("p", { class: "gltk-outcome-title" }, error.title),
            h("p", { class: "gltk-outcome-detail" }, error.detail),
            h("pre", { class: "gltk-outcome-raw" }, error.raw)
          ]),
          h("div", { class: "gltk-actions" }, [
            h("div", { class: "gltk-link-row" }, [
              h("button", { type: "button", onClick: () => flow.reset() }, "Re-estimate and retry")
            ])
          ])
        );
      }
      return h("div", { class: "gltk-root", "data-theme": props.theme }, [
        h("div", { class: "gltk-panel" }, children)
      ]);
    };
  }
});

// src/mock.ts
var PRESET_APPEALS = { low: 1n, standard: 3n, high: 5n };
var GEN_PER_TIME_UNIT = 10n ** 15n;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createMockKit(opts) {
  const delays = { estimate: 350, submit: 500, step: 600, ...opts?.delays };
  return {
    async estimate(input) {
      await sleep(delays.estimate);
      const appeals = BigInt(
        input.overrides?.appealRounds ?? PRESET_APPEALS[input.preset ?? "standard"] ?? 3n
      );
      const rotations = Array.from({ length: Number(appeals) + 1 }, () => 0n);
      const leaderRounds = BigInt(rotations.length) + appeals;
      const timeUnits = (100n + 5n * 200n) * (appeals * 2n + 1n);
      const timeUnitFees = timeUnits * GEN_PER_TIME_UNIT;
      const budgetPerRound = input.overrides?.executionBudgetPerRound ?? 76548000000000n;
      const executionBudget = budgetPerRound * leaderRounds;
      const messageFees = input.overrides?.totalMessageFees ?? 0n;
      const userValue = input.userValue ?? 0n;
      const feeValue = timeUnitFees + executionBudget + messageFees;
      return {
        distribution: {
          leaderTimeunitsAllocation: 100n,
          validatorTimeunitsAllocation: 200n,
          appealRounds: appeals,
          executionBudgetPerRound: budgetPerRound,
          executionConsumed: 0n,
          totalMessageFees: messageFees,
          rotations,
          maxPriceGenPerTimeUnit: GEN_PER_TIME_UNIT * 12n / 10n,
          storageFeeMaxGasPrice: 12n,
          receiptFeeMaxGasPrice: 300000000n
        },
        feeValue,
        userValue,
        total: feeValue + userValue,
        breakdown: { timeUnitFees, executionBudget, messageFees },
        caps: {
          genPerTimeUnit: GEN_PER_TIME_UNIT * 12n / 10n,
          storagePrice: 12n,
          receiptPrice: 300000000n
        },
        source: opts?.suggestions ? "developer" : "network-default",
        ...opts?.queueAhead !== void 0 ? { queue: { pendingAhead: opts.queueAhead } } : {},
        ...opts?.gasless ? { gasless: true } : {},
        refundable: true
      };
    },
    async submit() {
      await sleep(delays.submit);
      if (opts?.failWith) throw new Error(opts.failWith);
      return {
        genlayerTxId: "0x" + "ab".repeat(32),
        evmTxHash: "0x" + "cd".repeat(32)
      };
    },
    async track(genlayerTxId, onUpdate) {
      const outcome = opts?.outcome ?? {
        statusName: "ACCEPTED",
        executionResultName: "FINISHED_WITH_RETURN"
      };
      const steps = [
        { phase: "pending", genlayerTxId, queuePosition: 2 },
        { phase: "pending", genlayerTxId, queuePosition: 0 },
        { phase: "processing", genlayerTxId },
        {
          phase: "decided",
          genlayerTxId,
          statusName: outcome.statusName,
          executionResultName: outcome.executionResultName,
          successful: ["ACCEPTED", "FINALIZED"].includes(outcome.statusName.toUpperCase()) && outcome.executionResultName.toUpperCase() === "FINISHED_WITH_RETURN",
          contractAddress: "0x" + "12".repeat(20)
        }
      ];
      let last = { phase: "submitted", genlayerTxId };
      for (const step of steps) {
        await sleep(delays.step);
        last = step;
        onUpdate(step);
      }
      return last;
    },
    verification(quote, tx) {
      const fingerprint = [
        quote.feeValue,
        quote.distribution.appealRounds,
        quote.distribution.executionBudgetPerRound,
        tx.kind
      ].join("|");
      let hash = 0n;
      for (const char of fingerprint) hash = (hash * 31n + BigInt(char.charCodeAt(0))) % 2n ** 160n;
      return {
        feeConfigHash: `0x${hash.toString(16).padStart(40, "0")}`,
        summary: { total: quote.total.toString(), kind: tx.kind }
      };
    }
  };
}
export {
  CapsShield,
  FeeReceipt,
  GenLayerTransactionPanel,
  HoldToSign,
  PresetSelector,
  Timeline,
  createMockKit,
  describeError,
  describeOutcome,
  formatGen,
  formatWei,
  groupDigits,
  shortHash,
  splitGen,
  useTransactionFlow
};
