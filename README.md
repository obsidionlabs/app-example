## How to connect your app with Obsidion Wallet with sdk

aztec js package and sandbox versions are 0.75.0  
sdk: https://github.com/olehmisar/aztec-wallet-sdk

### 1. install obsidion wallet sdk

set this in your package.json

```json
"@shieldswap/wallet-sdk": "0.75.0-obsidion.0"
```

### 2. how to use sdk

```tsx
import { PopupWalletSdk } from "@shieldswap/wallet-sdk"
import { Eip1193Account, Contract } from "@shieldswap/wallet-sdk/eip1193"

const PXE_URL = "https://pxe.obsidion.xyz" // or http://localhost:8080
const pxe = createPXEClient(PXE_URL)

const example = async () => {
  // instantiate wallet sdk
  const sdk = new PopupWalletSdk(pxe)
  await sdk.connect()
  const account = await sdk.getAccount()

  // instantiate token contract
  const Token = Contract.fromAztec(TokenContract, TokenContractArtifact)
  const tokenAddress = "0x0000...00000"
  const token = await Token.at(tokenAddress, account.getAddress())

  // send tx
  const tx = await token.methods.transfer(account.getAddress(), 100).send().wait()
  // simulate tx
  const simulateTx = await token.methods.balance_of_private(account.getAddress()).simulate()
}
```

For more details, see the src/example.tsx
