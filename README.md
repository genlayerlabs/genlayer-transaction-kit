# GenLayer Transaction Kit

The trusted fee approval & signing surface for GenLayer transactions — review the fee
policy, hold to sign, follow consensus to an honest outcome. Works with any EIP-1193
wallet (mobile and non-MetaMask included); the GenLayer Snap is an optional
verification layer, never a requirement.

| Package | What it is |
| --- | --- |
| [`@genlayer/transaction-kit`](packages/core) | Framework-agnostic core: `estimate` → `PolicyQuote`, `submit` (direct route via the injected wallet), `track` to decided/finalized, `verification` fee-config hash. Built on genlayer-js v2. |
| [`@genlayer/transaction-kit-react`](packages/react) | `<GenLayerTransactionPanel />` + headless `useTransactionFlow` |
| [`@genlayer/transaction-kit-vue`](packages/vue) | Vue 3 equivalents |

Styling follows the [GenLayer design system](https://github.com/genlayer-foundation/genlayer-design)
(Space Grotesk / Switzer / JetBrains Mono, light-first with a dark theme), scoped under
`gltk-*` and themable via `--gltk-*` CSS variables.

Stage-1 scope: **direct submission only**. EIP-712 intents, the gateway contract and
ERC-7730 clear-signing metadata are stage 2 (see the wallet architecture doc in
`genlayer-wallet`).

## Installing before the npm release

npm `github:` dependencies can't reach monorepo subpackages, so each package is also
published as a packed orphan branch (`npm pack` output, dist included):

```jsonc
{
  "dependencies": {
    "@genlayer/transaction-kit": "github:genlayerlabs/genlayer-transaction-kit#pkg/core",
    "@genlayer/transaction-kit-react": "github:genlayerlabs/genlayer-transaction-kit#pkg/react",
    "@genlayer/transaction-kit-vue": "github:genlayerlabs/genlayer-transaction-kit#pkg/vue"
  }
}
```

These branches are refreshed manually on release-worthy changes and go away once the
packages are on npm.

## Quick start (React)

```tsx
import { createTransactionKit } from '@genlayer/transaction-kit';
import { GenLayerTransactionPanel } from '@genlayer/transaction-kit-react';
import '@genlayer/transaction-kit-react/styles.css';
import { testnetAsimov } from 'genlayer-js/chains';

const kit = createTransactionKit({ chain: testnetAsimov, provider: window.ethereum });

<GenLayerTransactionPanel
  kit={kit}
  tx={{ kind: 'write', address: contract, method: 'place_bet', args: [42] }}
  network="testnet-asimov"
  onDone={(status) => console.log(status)}
/>;
```

The adapters never import the core at runtime — the kit instance is injected and typed
structurally, so the packages version independently.
