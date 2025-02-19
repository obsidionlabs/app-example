# App Development Guide with Obsidion Wallet

## Basic Info

- Obsidion app: https://obsidion.vercel.app/
- Our hosted PXE url: https://pxe.obsidion.xyz/
- aztec-package/sandbox version: _0.76.1_
- wallet sdk: https://www.npmjs.com/package/@shieldswap/wallet-sdk
  - \*use 0.76.1-obsidion.1 version of this sdk.

### 1. install obsidion wallet sdk

```shell
pnpm i @shieldswap/wallet-sdk@0.76.1-obsidion.4
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

For more details, see the src/example.tsx

## Notes

#### Change Sandbox URL

it's recommended to use your own local sandbox if you can as our hosted sandbox is a bit slower. you
can change pxe url from Settings > Services in the Obsidion Wallet UI. If this doesn't work,
directly change the value in local storage where the key is "obsidion_pxe_url".

#### Change L1 RPC URL

you can change L1 RPC URL by setting the `eth_rpc_url` in local storage to your own L1 RPC URL.

#### Devnet

not supported yet.

## Troubleshooting

#### Wallet Connect Issues

If you encounter any error with wallet connect, please delete all the cache under indexedDB ->
WALLET_CONNECT_V2_INDEXED_DB in local storage.

#### CORS error with your local sandbox.

If you can't use your local sandbox due to CORS's blocking, you probably need to run a proxy server
locally at a different port that relays the calls between wallet frontend and your local sandbox.
Feel free to reach out to us, then we can share the codebase of the proxy server.

## Support

Please join
[our Signal group](https://signal.group/#CjQKIDBmFVuI9gz2cRZaa3HD4-tJpGc8PrWQ9aec_AomvJRjEhDEHAiu0G6zkaF9xf9Q3ufI)
for more help and feedback.
