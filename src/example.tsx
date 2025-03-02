import { useEffect, useState } from "react"
import { Button, Checkbox, Loader, Stack, Text, TextInput } from "@mantine/core"
import { AztecAddress } from "@aztec/aztec.js"
import { TokenContract } from "@aztec/noir-contracts.js/Token"
import type { IntentAction } from "@shieldswap/wallet-sdk"
import { Contract } from "@shieldswap/wallet-sdk/eip1193"
import { useAccount } from "@shieldswap/wallet-sdk/react"
import { ReownPopupWalletSdk } from "@shieldswap/wallet-sdk"
import { fallbackOpenPopup } from "./fallback"

class Token extends Contract.fromAztec(TokenContract) {}

const NODE_URL = "http://localhost:8080" // or "https://pxe.obsidion.xyz"
// const NODE_URL = "https://pxe.obsidion.xyz"

const wcOptions = {
  projectId: "067a11239d95dd939ee98ea22bde21da",
}

const params = {
  walletUrl: "http://localhost:5173",
  fallbackOpenPopup: fallbackOpenPopup,
}

const sdk = new ReownPopupWalletSdk(NODE_URL, wcOptions, params)

export function Example() {
  const account = useAccount(sdk)

  const [tokenContract, setTokenContract] = useState<Token | null>(null)
  const [tokenAddress, setTokenAddress] = useState<string | null>(() => {
    return localStorage.getItem("tokenAddress")
  })

  const [privateBalance, setPrivateBalance] = useState<string | null>(null)
  const [publicBalance, setPublicBalance] = useState<string | null>(null)

  const [amount, setAmount] = useState<string | null>(null)
  const [recipient, setRecipient] = useState<string | null>(null)
  const [withAuthWitness, setWithAuthWitness] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem("tokenAddress", tokenAddress || "")
  }, [tokenAddress])

  const handleAddToken = async () => {
    console.log("adding token...")
    console.log("account: ", account)
    console.log("tokenContract: ", tokenContract)

    if (!tokenAddress) {
      setError("Token address not found")
      return
    }

    await sdk.watchAssets([
      {
        type: "ARC20",
        options: {
          address: tokenAddress,
          name: "TEST",
          symbol: "TEST",
          decimals: 18,
          image: "",
        },
      },
    ])
  }

  const handleFetchBalances = async () => {
    console.log("fetching balances...")
    console.log("account: ", account)
    console.log("tokenContract: ", tokenContract)

    if (!account) {
      setError("Account not found")
      return
    }
    if (!tokenContract) {
      setError("Token contract not found")
      return
    }

    const privateBalance = await tokenContract.methods
      .balance_of_private(account.getAddress())
      .simulate()
    console.log("privateBalance: ", privateBalance)

    const token = await Token.at(tokenContract.address, account)
    const publicBalance = await token.methods.balance_of_public(account.getAddress()).simulate()

    setPublicBalance(((publicBalance as unknown as bigint) / BigInt(1e18)).toString())
    setPrivateBalance(((privateBalance as unknown as bigint) / BigInt(1e18)).toString())
  }

  useEffect(() => {
    if (account && tokenContract) {
      handleFetchBalances()
    }
  }, [account, tokenContract])

  useEffect(() => {
    if (tokenAddress && account) {
      const initTokenContract = async () => {
        const tokenContract = await Token.at(AztecAddress.fromString(tokenAddress), account)
        setTokenContract(tokenContract)
      }
      initTokenContract()
    }
  }, [tokenAddress, account])

  const handleSendTx = async (isPrivate: boolean, withAuthWitness: boolean = false) => {
    setLoading(true)
    setError(null)
    if (!account) {
      setError("Account not found")
      setLoading(false)
      return
    }

    if (!tokenContract) {
      setError("Token contract not found")
      setLoading(false)
      return
    }

    if (!amount) {
      setError("Amount is required")
      setLoading(false)
      return
    }

    if (!recipient) {
      setError("Recipient is required")
      setLoading(false)
      return
    }

    console.log("sending token")

    try {
      let authwitRequests: IntentAction[] | undefined = undefined
      if (withAuthWitness) {
        authwitRequests = [
          {
            caller: account.getAddress(),
            action: await tokenContract.methods
              .transfer_in_private(
                account.getAddress(),
                AztecAddress.fromString(recipient),
                BigInt(amount) * BigInt(1e18),
                0,
              )
              .request(),
          },
          {
            caller: account.getAddress(),
            action: await tokenContract.methods
              .transfer_to_public(
                account.getAddress(),
                AztecAddress.fromString(recipient),
                BigInt(amount) * BigInt(1e18),
                0,
              )
              .request(),
          },
        ]
      }
      console.log("authwitRequests: ", authwitRequests)

      const txHash = await tokenContract.methods[
        isPrivate ? "transfer_in_private" : "transfer_in_public"
      ](
        account.getAddress(),
        AztecAddress.fromString(recipient),
        BigInt(amount) * BigInt(1e18),
        0,
        withAuthWitness ? { authWitnesses: authwitRequests } : undefined,
      )
        .send()
        .wait()
      console.log("txHash: ", txHash)
    } catch (e) {
      setError("Error sending transaction")
      setLoading(false)
      return
    }

    setLoading(false)
    handleFetchBalances()
  }

  const handleMintToken = async () => {
    if (!account) {
      setError("Account not found")
      setLoading(false)
      return
    }

    setLoading(true)

    const deployTx = await Token.deploy(
      account,
      account.getAddress(),
      "Token",
      "TEST",
      18n,
    )
      .send()
      .wait()
    console.log("deployTx: ", deployTx)

    const tokenContract = deployTx.contract
    await tokenContract.methods
      .mint_to_private(account.getAddress(), account.getAddress(), 1000e18)
      .send()
      .wait()
    await tokenContract.methods
      .transfer_in_private(account.getAddress(), account.address, 1000e18, 0)
      .send()
      .wait()
    await tokenContract.methods.mint_to_public(account.address, 1000e18).send().wait()

    const token = await Token.at(tokenContract.address, account)
    setTokenContract(token)
    setTokenAddress(tokenContract.address.toString())
    setLoading(false)
    handleFetchBalances()
  }

  return (
    <Stack align="center" justify="space-between" gap="md" mt={100}>
      <Text size="30px">Example Token App</Text>
      <Text my={20} size="18px">
        This is an example token app that demonstrates app integration with Obsidion Wallet.
      </Text>

      {account ? (
        <>
          <Text size="sm">Connected Account: {account.getAddress().toString()}</Text>
          {tokenContract && tokenAddress ? (
            <>
              <Text size="sm">Token: {tokenAddress}</Text>
              <div style={{ display: "flex", gap: 10 }}>
                <Text>Private Balance: {privateBalance ? `${privateBalance} TEST` : "0 TEST"}</Text>
                <Text>Public Balance: {publicBalance ? `${publicBalance} TEST` : "0 TEST"}</Text>
              </div>

              <TextInput
                style={{ width: "50%" }}
                placeholder="Amount"
                value={amount || ""}
                onChange={(e) => setAmount(e.target.value)}
              />

              <TextInput
                style={{ width: "50%" }}
                placeholder="Recipient"
                value={recipient || ""}
                onChange={(e) => setRecipient(e.target.value)}
              />
              <Checkbox
                label="With Random AuthWit ( Just to see how tx confirmation works w/ authwits )"
                checked={withAuthWitness}
                onChange={(e) => setWithAuthWitness(e.target.checked)}
              />
              <div style={{ display: "flex", gap: 20 }}>
                <Button
                  mt={10}
                  disabled={loading}
                  onClick={() => handleSendTx(true, withAuthWitness)}
                >
                  Send Token (Private)
                </Button>
                <Button
                  mt={10}
                  disabled={loading}
                  onClick={() => handleSendTx(false, withAuthWitness)}
                >
                  Send Token (Public)
                </Button>
              </div>

              <div style={{ display: "flex", gap: 20 }}>
                <Button mt={10} onClick={() => handleFetchBalances()}>
                  Fetch Balances
                </Button>
                <Button mt={10} onClick={() => handleAddToken()}>
                  Add Token
                </Button>
              </div>
              <Button color="gray" mt={10} onClick={() => sdk.disconnect()}>
                Disconnect
              </Button>
              {error && <Text color="red">{error}</Text>}
            </>
          ) : (
            <>
              <TextInput
                label="Token Address"
                style={{ width: "50%" }}
                placeholder="0x..."
                value={tokenAddress || ""}
                onChange={(e) => {
                  setTokenAddress(e.target.value)
                  localStorage.setItem("tokenAddress", e.target.value)
                }}
              />
              <div style={{ display: "flex", gap: 20 }}>
                <Button mt={10} disabled={loading} onClick={() => handleMintToken()}>
                  Deploy & Mint Token
                </Button>
              </div>
              {error && <Text color="red">{error}</Text>}
            </>
          )}
        </>
      ) : (
        <Button
          onClick={async () => {
            console.log("connecting...")
            const account = await sdk.connect()
            console.log("account: ", account)
          }}
        >
          Connect
        </Button>
      )}
      {loading && <Loader mt={10} size="sm" />}
    </Stack>
  )
}
