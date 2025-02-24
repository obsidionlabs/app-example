# App Development Guide with Obsidion Wallet

## Basic Info

- Obsidion app: https://obsidion.vercel.app/
- Our hosted PXE url: https://pxe.obsidion.xyz/
- aztec-package/sandbox version: _0.76.1_
- wallet sdk: https://www.npmjs.com/package/@shieldswap/wallet-sdk
  - \*use 0.76.1-obsidion.9 version of this sdk.

### 1. install obsidion wallet sdk

```shell
pnpm i @shieldswap/wallet-sdk@0.76.1-obsidion.9
```

### 2. how to use sdk

```tsx
import { ReownPopupWalletSdk } from "@shieldswap/wallet-sdk"
import { Contract } from "@shieldswap/wallet-sdk/eip1193"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

const PXE_URL = "https://pxe.obsidion.xyz" // or http://localhost:8080
const pxe = createPXEClient(PXE_URL)

const wcOptions = {
  // you can obtain your own project id from https://cloud.reown.com/sign-up
  projectId: "067a11239d95dd939ee98ea22bde21da",
}

const sdk = new ReownPopupWalletSdk(pxe, wcOptions)

// example method that does...
// 1. connect to wallet
// 2. instantiate token contract
// 3. send tx

const exampleMethod = async () => {
  // instantiate wallet sdk
  const account = await sdk.connect()

  // instantiate token contract
  const Token = Contract.fromAztec(TokenContract, TokenContractArtifact)
  const tokenAddress = "0x0000...00000"
  const token = await Token.at(tokenAddress, account.getAddress())

  // send tx
  const tx = await token.methods.transfer(account.getAddress(), 100).send().wait()
  // simulate tx
  const simulateTx = await token.methods.balance_of_private(account.getAddress()).simulate()
}

exampleMethod()
```

For more details, see the [src/example.tsx](./src/example.tsx)

## Configuration & Tools

### Change Sandbox URL &  L1 RPC URL

it's recommended to use your own local sandbox if you can as our hosted sandbox is a bit slower. you
can change pxe url and l1 rpc url from Settings > Services in the Obsidion Wallet UI. 

<img src="https://github.com/user-attachments/assets/bc2799de-382b-40ab-83ff-ce4abd2a1507" alt="Screenshot" width="50%" />


If this doesn't work,
directly change the value in local storage where the key is `obsidion_pxe_url` and `eth_rpc_url` respectively.

### Advanced Mode

Note Discovery and PXE Dashboard...

## Troubleshooting

### Wallet Connect Issues

example:

```shell
{context: 'client'}  Error: No matching key. history: 1740320789580213
```

If you encounter any error with wallet connect, pleasetry the following:

1. disconnect() with `sdk.disconnect()`
2. delete all the cache under indexedDB -> WALLET_CONNECT_V2_INDEXED_DB in local storage in your app
   site.
3. clear wallet connect cache for wallet site too.

### simulate() with `aztec_call` not working

If simulate() with `aztec_call` not working, and it's not resolved even after clearing wallet connect
cache, one of the followings might be the cause.

#### 1. Wallet Tab Closed
If wallet tab, e.g. obsidion.vercel.app, is closed, simulation rpc call gets drop. Make sure you keep it open while using dapp. 

#### 2. Duplicate Tabs
you open either obsidion wallet tab or app tab in multiple tabs.

### CORS error with your local sandbox.

If you can't use your local sandbox due to CORS's blocking, you probably need to run a proxy server
locally at a different port that relays the calls between wallet frontend and your local sandbox.
Feel free to reach out to us, then we can share the codebase of the proxy server.

### Devnet

not supported yet. Chaning sandbox & l1 rpc URLs wouldn't probably work. 

## Support

Please join
[our Signal group](https://signal.group/#CjQKIDBmFVuI9gz2cRZaa3HD4-tJpGc8PrWQ9aec_AomvJRjEhDEHAiu0G6zkaF9xf9Q3ufI)
for more help and feedback.

## Run example app
```shell
pnpm dev
```


