# App Development Guide with Obsidion Wallet

## Basic Info

- Obsidion app: https://app.obsidion.xyz/
- Node url: https://aztec-alpha-testnet-fullnode.zkv.xyz
- aztec-package/sandbox version: _1.0.0_
- wallet sdk: https://www.npmjs.com/package/@nemi-fi/wallet-sdk
  - \*use 1.0.0 version of this sdk.

### 1. install obsidion wallet sdk

```shell
pnpm i @nemi-fi/wallet-sdk@1.0.0
```

### 2. how to use sdk

```tsx
import { AztecWalletSdk, obsidion } from "@nemi-fi/wallet-sdk"
import { Contract } from "@nemi-fi/wallet-sdk/eip1193"
import {
  TokenContract,
  TokenContractArtifact,
} from "@defi-wonderland/aztec-standards/current/artifacts/artifacts/Token.js"

// const NODE_URL = "http://localhost:8080" // sandbox
const NODE_URL = "https://aztec-alpha-testnet-fullnode.zkv.xyz" // testnet
const WALLET_URL = "https://app.obsidion.xyz"

// This should be instantiated outside of any js classes / react components
const sdk = new AztecWalletSdk({
  aztecNode: NODE_URL,
  connectors: [obsidion({ walletUrl: WALLET_URL })],
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
  const tx = await token.methods
    .transfer_private_to_private(account.getAddress(), 100)
    .send()
    .wait()
  // simulate tx
  const balance = await token.methods.balance_of_private(account.getAddress()).simulate()
}

exampleMethod()
```

For more details, see the [src/example.tsx](./src/example.tsx)

#### Batch Call

```tsx
const batchedTx = new BatchCall(aztecAccount, [
  transferPrivate, // await token.methods.transfer_private_to_private(...).request()
  transferPublic, // await token.methods.transfer_public_to_public(...).request()
])

await batchedTx.send().wait({ timeout: 200000 })
```

#### Token Authwit

```tsx
      const tx = await deposit.methods.deposit_token(
        account.getAddress(),
        amount
        {
          // authwitness example ( only for private authwit )
          authWitnesses: {
            caller: account.getAddress(),
            action: tokenContract.methods.transfer_private_to_private(
              account.getAddress(),
              AztecAddress.fromString(recipient),
              parseUnits(amount.toString(), token.decimals),
              0,
            ),
          } as IntentAction,
        },
      )
        .send()
        .wait({
          timeout: 200000,
        })

```

#### Register Contract and Sender

```tsx
const privateBalance = await tokenContract.methods
  .balance_of_private(account.getAddress(), {
    registerSenders: [account.address],
    registerContracts: [
      {
        address: contractForRegister.address,
        instance: contractForRegister.instance,
        artifact: contractForRegister.artifact,
      } as RegisterContract,
    ],
  })
  .simulate()
```

## Configuration & Tools

### Networks

Obsiidon App offeres three default networks below

#### Sandbox

- PXE: In-Browser
- Proving Disabled
  - You can enable proving by setting `prover_enabled` to `true` in local storage.
- Node URL: http://localhost:8080
- L1 RPC URL: http://localhost:8545

#### Testnet

- PXE: In-Browser
- Proving Enabled
- Node URL: https://aztec-alpha-testnet-fullnode.zkv.xyz
- L1 RPC URL: "https://eth-sepolia.public.blastapi.io"

#### Custom Networks

You can edit URLs for each network in the Obsidion App's network settings.

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
pnpm i
pnpm dev
```
