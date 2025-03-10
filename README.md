# App Development Guide with Obsidion Wallet

## Basic Info

- Obsidion app: https://app.obsidion.xyz/
- Our hosted PXE url: https://pxe.obsidion.xyz/
- aztec-package/sandbox version: _0.76.1_
- wallet sdk: https://www.npmjs.com/package/@shieldswap/wallet-sdk
  - \*use 0.76.1-next.9 version of this sdk.

### 1. install obsidion wallet sdk

```shell
pnpm i @shieldswap/wallet-sdk@0.76.1-next.9
```

### 2. how to use sdk

```tsx
import { AztecWalletSdk, obsidion } from "@shieldswap/wallet-sdk"
import { Contract } from "@shieldswap/wallet-sdk/eip1193"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

const NODE_URL = "http://localhost:8080" // or "https://pxe.obsidion.xyz"
const pxe = createPXEClient(NODE_URL)

const PROJECT_ID = "067a11239d95dd939ee98ea22bde21da"

const sdk = new AztecWalletSdk({
  aztecNode: NODE_URL,
  adapters: [obsidion({ projectId: PROJECT_ID })],
})

// example method that does...
// 1. connect to wallet
// 2. instantiate token contract
// 3. send tx

class Token extends Contract.fromAztec(TokenContract) {}

const exampleMethod = async () => {
  // instantiate wallet sdk
  const account = await sdk.connect("obsidion")

  const tokenAddress = AztecAddress.fromString("0x0000...00000")
  const token = await Token.at(tokenAddress, account.getAddress())

  // send tx
  const tx = await token.methods.transfer(account.getAddress(), 100).send().wait()
  // simulate tx
  const balance = await token.methods.balance_of_private(account.getAddress()).simulate()
}

exampleMethod()
```

For more details, see the [src/example.tsx](./src/example.tsx)

## Configuration & Tools

### Change Sandbox URL & L1 RPC URL

it's recommended to use your own local sandbox if you can as our hosted sandbox is a bit slower. you
can switch network to sandbox in Settings > Networks in the Obsidion Wallet UI.

## Advanced Mode

In settings navigate to advanced to activate these features and they will become active in your
navbar.

### The PXE Dashboard

This is a tool to connect to receive insights on their PXE and the Aztec node that they are
connected to in a readable format for quick review.

1. Node Information (`getNodeInfo`) Returns the information about the server's node Includes current
   Node version, compatible Noir version, L1 chain identifier, protocol version, and L1 address of
   the rollup contract

2. Contracts (`getContracts`) Lists all of the contract addresses that have been registered in your
   PXE

3. Registered Accounts (`getRegisteredAccounts`) Displays all of the user accounts (Aztec Address)
   that have been registered with your PXE

4. Senders (`getSenders`) The addresses of the registered senders in your PXE These are the
   addresses you can communicate with

5. Block Information (`getBlock`) This provides detailed information about the current block of the
   network Includes the block number, block timestamp, block hash, transaction count and other
   metadata

### Note Discovery

Allows users to view and manage their private notes on the Aztec Network. The feature provides an
interface to discover, categorize, and monitor notes associated with your accounts. It scans the
chain for notes associated with your account, decrypts the notes using your private keys and
categorizes the notes based on known assets and unknown assets. It is useful for discovering,
monitoring and verifying notes that are linked to your account. Users can switch between accounts to
view notes specific to each account.

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

If simulate() with `aztec_call` not working, and it's not resolved even after clearing wallet
connect cache, one of the followings might be the cause.

#### 1. Wallet Tab Closed

If wallet tab, e.g. app.obsidion.xyz, is closed, simulation rpc call gets drop. Make sure you keep
it open while using dapp.

#### 2. Duplicate Tabs

you open either obsidion wallet tab or app tab in multiple tabs.

### CORS error with your local sandbox.

If you can't use your local sandbox due to CORS's blocking, you probably need to run a proxy server
locally at a different port that relays the calls between wallet frontend and your local sandbox.
Feel free to reach out to us, then we can share the codebase of the proxy server.

## Support

Please join
[our Signal group](https://signal.group/#CjQKIDBmFVuI9gz2cRZaa3HD4-tJpGc8PrWQ9aec_AomvJRjEhDEHAiu0G6zkaF9xf9Q3ufI)
for more help and feedback.

## Run example app

```shell
pnpm dev
```
