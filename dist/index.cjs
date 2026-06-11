"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CapsShield: () => CapsShield,
  FeeReceipt: () => FeeReceipt,
  GenLayerTransactionPanel: () => GenLayerTransactionPanel,
  HoldToSign: () => HoldToSign,
  PresetSelector: () => PresetSelector,
  Timeline: () => Timeline,
  VerifyBadge: () => VerifyBadge,
  createMockKit: () => createMockKit,
  describeError: () => describeError,
  describeOutcome: () => describeOutcome,
  formatGen: () => formatGen,
  formatWei: () => formatWei,
  groupDigits: () => groupDigits,
  shortHash: () => shortHash,
  splitGen: () => splitGen,
  useTransactionFlow: () => useTransactionFlow
});
module.exports = __toCommonJS(index_exports);

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
var import_react = require("react");
function useTransactionFlow(opts) {
  const { kit, tx, userValue, trackUntil = "decided" } = opts;
  const [preset, setPreset] = (0, import_react.useState)("standard");
  const [overrides, setOverrides] = (0, import_react.useState)(void 0);
  const [state, setState] = (0, import_react.useState)({ step: "estimating", preset: "standard" });
  const generation = (0, import_react.useRef)(0);
  const estimate = (0, import_react.useCallback)(async () => {
    const gen = ++generation.current;
    setState({ step: "estimating", preset });
    try {
      const quote2 = await kit.estimate({ preset, overrides, userValue }, tx);
      if (generation.current !== gen) return;
      setState({ step: "review", preset, quote: quote2 });
    } catch (error) {
      if (generation.current !== gen) return;
      setState({
        step: "error",
        preset,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, [kit, preset, overrides, userValue, tx]);
  (0, import_react.useEffect)(() => {
    void estimate();
  }, [estimate]);
  const quote = "quote" in state ? state.quote : void 0;
  const verification = (0, import_react.useMemo)(() => {
    if (!quote) return void 0;
    try {
      return kit.verification(quote, tx);
    } catch {
      return void 0;
    }
  }, [kit, quote, tx]);
  const approve = (0, import_react.useCallback)(async () => {
    if (state.step !== "review") return;
    const { quote: approvedQuote } = state;
    setState({ step: "signing", preset, quote: approvedQuote });
    try {
      const { genlayerTxId, evmTxHash } = await kit.submit(approvedQuote, tx);
      let last = { phase: "submitted", genlayerTxId, evmTxHash };
      setState({ step: "tracking", preset, quote: approvedQuote, status: last });
      last = await kit.track(
        genlayerTxId,
        (status) => {
          last = { evmTxHash, ...status };
          setState({ step: "tracking", preset, quote: approvedQuote, status: last });
        },
        { until: trackUntil }
      );
      setState({ step: "done", preset, quote: approvedQuote, status: { evmTxHash, ...last } });
    } catch (error) {
      setState({
        step: "error",
        preset,
        quote: approvedQuote,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, [kit, state, preset, tx, trackUntil]);
  const reset = (0, import_react.useCallback)(() => {
    void estimate();
  }, [estimate]);
  return { state, preset, setPreset, overrides, setOverrides, quote, verification, approve, reset };
}

// src/components.tsx
var import_react2 = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var PRESET_COPY = {
  low: { label: "Low", sub: "1 appeal round" },
  standard: { label: "Standard", sub: "3 appeal rounds" },
  high: { label: "High", sub: "5 appeal rounds" }
};
function Gen({ wei, busy }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-total-value", "data-busy": busy ? "true" : void 0, children: [
    formatGen(wei),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-unit", children: "GEN" })
  ] });
}
function ReceiptRow(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-row-label", children: [
      props.label,
      props.hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-row-hint", children: props.hint }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-row-value", children: [
      formatGen(props.wei),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-unit", children: "GEN" })
    ] })
  ] });
}
function FeeReceipt({ quote, busy }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-receipt", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ReceiptRow,
      {
        label: "Consensus work",
        hint: "leader + validators, per round",
        wei: quote.breakdown.timeUnitFees
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ReceiptRow,
      {
        label: "Execution budget",
        hint: "storage + receipt writes",
        wei: quote.breakdown.executionBudget
      }
    ),
    quote.breakdown.messageFees > 0n ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReceiptRow, { label: "Message budget", hint: "child transactions", wei: quote.breakdown.messageFees }) : null,
    quote.userValue > 0n ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReceiptRow, { label: "Value sent", hint: "delivered to the contract", wei: quote.userValue }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-total", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-total-label", children: "Total deposit" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Gen, { wei: quote.total, busy })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-refundable", children: "Unused amounts are refunded when the transaction finalizes." }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "gltk-source", "data-source": quote.source, children: [
      quote.source === "developer" ? "Sized from the developer\u2019s measured fee profile" : "Sized from network defaults",
      " \xB7 ",
      "live prices, never simulated"
    ] })
  ] });
}
function PresetSelector(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-presets", role: "radiogroup", "aria-label": "Fee preset", children: Object.keys(PRESET_COPY).map((preset) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      role: "radio",
      "aria-checked": props.value === preset,
      className: "gltk-preset",
      "data-active": props.value === preset ? "true" : void 0,
      disabled: props.disabled,
      onClick: () => props.onChange(preset),
      children: [
        PRESET_COPY[preset].label,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: PRESET_COPY[preset].sub })
      ]
    },
    preset
  )) });
}
function CapsShield({ quote }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-caps", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-caps-title", children: "Price protection" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-caps-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-cap", children: [
        "Time-unit price cap ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
          formatGen(quote.caps.genPerTimeUnit),
          " GEN"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-cap", children: [
        "Storage price cap ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
          quote.caps.storagePrice.toString(),
          " wei"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-cap", children: [
        "Receipt gas cap ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
          quote.caps.receiptPrice.toString(),
          " wei"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-caps-note", children: "If network prices rise above any cap, the transaction is rejected and nothing is charged." })
  ] });
}
function VerifyBadge(props) {
  if (!props.feeConfigHash) return null;
  const verified = props.snapState === "verified";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-verify", "data-state": verified ? "verified" : void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: verified ? "\u2713 Verified by GenLayer Snap" : "Policy fingerprint" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: shortHash(props.feeConfigHash, 10, 6) })
  ] });
}
function HoldToSign(props) {
  const holdMs = props.holdMs ?? 900;
  const [holding, setHolding] = (0, import_react2.useState)(false);
  const timer = (0, import_react2.useRef)();
  const touchHandled = (0, import_react2.useRef)(false);
  const start = (0, import_react2.useCallback)(
    (event) => {
      if (props.disabled || event.pointerType === "mouse") return;
      touchHandled.current = true;
      setHolding(true);
      timer.current = setTimeout(() => {
        setHolding(false);
        props.onConfirm();
      }, holdMs);
    },
    [props, holdMs]
  );
  const cancel = (0, import_react2.useCallback)(() => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: "gltk-hold",
      "data-holding": holding ? "true" : void 0,
      style: { ["--gltk-hold-ms"]: `${holdMs}ms` },
      disabled: props.disabled,
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onClick: () => {
        if (props.disabled) return;
        if (touchHandled.current) {
          touchHandled.current = false;
          return;
        }
        props.onConfirm();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-hold-fill", "aria-hidden": true }),
        props.label ?? "Approve & sign",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-hold-hint", children: "hold to confirm" })
      ]
    }
  );
}
var PHASES = [
  { key: "submitted", label: "Submitted to the chain" },
  { key: "processing", label: "Consensus in progress" },
  { key: "decided", label: "Decided" },
  { key: "finalized", label: "Finalized" }
];
function Timeline({ status }) {
  const order = ["submitted", "pending", "processing", "decided", "finalized"];
  const current = order.indexOf(status.phase);
  const outcome = describeOutcome(status.statusName, status.executionResultName);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-timeline", "aria-live": "polite", children: PHASES.map((phase, index) => {
    const phasePos = order.indexOf(phase.key);
    const state = phasePos < current ? "done" : phasePos === current ? "active" : "idle";
    const isOutcomeNode = phase.key === "decided" && phasePos <= current;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: "gltk-node",
        "data-state": state,
        "data-tone": isOutcomeNode && outcome.tone !== "success" ? outcome.tone : void 0,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-node-rail", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-node-dot" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-node-line" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-node-label", children: [
            isOutcomeNode ? `Decided \u2014 ${outcome.title}` : phase.label,
            phase.key === "submitted" && status.genlayerTxId ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-node-sub", children: [
              "tx ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: shortHash(status.genlayerTxId) })
            ] }) : null,
            phase.key === "submitted" && status.queuePosition !== void 0 && current <= order.indexOf("pending") ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-node-sub", children: status.queuePosition === 0 ? "next in queue" : `${status.queuePosition} ahead in queue` }) : null,
            phase.key === "decided" && isOutcomeNode && outcome.tone === "success" && status.contractAddress ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "gltk-node-sub", children: [
              "contract ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: shortHash(status.contractAddress) })
            ] }) : null
          ] })
        ]
      },
      phase.key
    );
  }) });
}
function describeTarget(tx) {
  if (tx.kind === "deploy") return { kind: "Deploy", what: "New intelligent contract" };
  return { kind: "Write", what: `${tx.method}() \xB7 ${shortHash(tx.address)}` };
}
function GenLayerTransactionPanel(props) {
  const flow = useTransactionFlow({
    kit: props.kit,
    tx: props.tx,
    userValue: props.userValue,
    trackUntil: props.trackUntil
  });
  const target = (0, import_react2.useMemo)(() => describeTarget(props.tx), [props.tx]);
  const { state } = flow;
  const doneRef = (0, import_react2.useRef)(false);
  if (state.step === "done" && !doneRef.current) {
    doneRef.current = true;
    props.onDone?.(state.status);
  }
  const busy = state.step === "estimating";
  const reviewing = state.step === "review" || busy;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-root", "data-theme": props.theme ?? "light", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-head-title", children: "GenLayer transaction" }),
      props.network ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-head-network", children: props.network }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-target", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-target-kind", children: target.kind }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "gltk-target-what", children: target.what })
    ] }),
    reviewing && flow.quote?.gasless ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-gasless", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-gasless-title", children: "No fees on this network" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-gasless-detail", children: "Fee accounting is disabled here \u2014 no deposit is taken and nothing is charged." })
      ] }),
      flow.quote.userValue > 0n ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FeeReceipt, { quote: flow.quote, busy }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HoldToSign, { onConfirm: () => void flow.approve(), disabled: busy }) })
    ] }) : null,
    reviewing && !flow.quote?.gasless ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PresetSelector, { value: flow.preset, onChange: flow.setPreset, disabled: busy }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "gltk-advanced", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Advanced" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-advanced-grid", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "gltk-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Appeal rounds" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "number",
              min: 1,
              placeholder: "preset",
              disabled: busy,
              onChange: (event) => {
                const raw = event.target.value.trim();
                const parsed = raw === "" ? void 0 : Number(raw);
                flow.setOverrides(
                  parsed !== void 0 && Number.isInteger(parsed) && parsed >= 1 ? { ...flow.overrides, appealRounds: BigInt(parsed) } : (() => {
                    const rest = { ...flow.overrides };
                    delete rest.appealRounds;
                    return Object.keys(rest).length ? rest : void 0;
                  })()
                );
              }
            }
          )
        ] }) })
      ] }),
      flow.quote ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FeeReceipt, { quote: flow.quote, busy }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapsShield, { quote: flow.quote }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          VerifyBadge,
          {
            feeConfigHash: flow.verification?.feeConfigHash,
            snapState: props.snapState
          }
        ),
        flow.quote.queue ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-queue", "data-clear": flow.quote.queue.pendingAhead === 0 ? "true" : void 0, children: flow.quote.queue.pendingAhead === 0 ? "Queue is clear \u2014 starts immediately" : `${flow.quote.queue.pendingAhead} transaction${flow.quote.queue.pendingAhead === 1 ? "" : "s"} queued ahead for this contract` }) : null
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HoldToSign, { onConfirm: () => void flow.approve(), disabled: busy || !flow.quote }) })
    ] }) : null,
    state.step === "signing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      state.quote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FeeReceipt, { quote: state.quote }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-outcome", "data-tone": "warn", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-outcome-title", children: "Waiting for your wallet" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-outcome-detail", children: "Confirm the transaction in your wallet to continue." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-actions" })
    ] }) : null,
    state.step === "tracking" || state.step === "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Timeline, { status: state.status }),
      state.step === "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outcome, { status: state.status }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-actions", children: state.step === "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-link-row", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: flow.reset, children: "New transaction" }) }) : null })
    ] }) : null,
    state.step === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorSurface, { message: state.message, onRetry: flow.reset }) : null
  ] }) });
}
function Outcome({ status }) {
  const outcome = describeOutcome(status.statusName, status.executionResultName);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-outcome", "data-tone": outcome.tone, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-outcome-title", children: outcome.title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-outcome-detail", children: outcome.detail })
  ] });
}
function ErrorSurface({ message, onRetry }) {
  const error = describeError(message);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gltk-outcome", "data-tone": "error", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-outcome-title", children: error.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "gltk-outcome-detail", children: error.detail }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "gltk-outcome-raw", children: error.raw })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gltk-link-row", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onRetry, children: "Re-estimate and retry" }) }) })
  ] });
}

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CapsShield,
  FeeReceipt,
  GenLayerTransactionPanel,
  HoldToSign,
  PresetSelector,
  Timeline,
  VerifyBadge,
  createMockKit,
  describeError,
  describeOutcome,
  formatGen,
  formatWei,
  groupDigits,
  shortHash,
  splitGen,
  useTransactionFlow
});
