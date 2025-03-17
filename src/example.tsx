import { useEffect, useState } from "react"
import { Button, Checkbox, Loader, Stack, Text, TextInput } from "@mantine/core"
import { AztecAddress, readFieldCompressedString } from "@aztec/aztec.js"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { BatchCall, Contract, IntentAction } from "@shieldswap/wallet-sdk/eip1193"
import { useAccount } from "@shieldswap/wallet-sdk/react"
import { AztecWalletSdk, obsidion } from "@shieldswap/wallet-sdk"
import { formatUnits, parseUnits } from "viem"

class Token extends Contract.fromAztec(TokenContract) {}

const NODE_URL = "http://localhost:8080" // or "http://35.227.171.86:8080"
const WALLET_URL = "http://localhost:5173" // or "https://app.obsidion.xyz"
const PROJECT_ID = "067a11239d95dd939ee98ea22bde21da"

const sdk = new AztecWalletSdk({
  aztecNode: NODE_URL,
  connectors: [obsidion({ walletUrl: WALLET_URL, projectId: PROJECT_ID })],
})

type TokenType = {
  address: string
  name: string
  symbol: string
  decimals: number
}

export function Example() {
  const account = useAccount(sdk)

  const [tokenContract, setTokenContract] = useState<Token | null>(null)
  const [token, setToken] = useState<TokenType | null>(() => {
    const storedToken = localStorage.getItem("token")
    if (!storedToken) return null
    try {
      return JSON.parse(storedToken) as TokenType
    } catch (e) {
      console.error("Failed to parse token from localStorage:", e)
      return null
    }
  })

  const [privateBalance, setPrivateBalance] = useState<string | null>(null)
  const [publicBalance, setPublicBalance] = useState<string | null>(null)

  const [amount, setAmount] = useState<string | null>(null)
  const [recipient, setRecipient] = useState<string | null>(null)
  const [withAuthWitness, setWithAuthWitness] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadToken = async () => {
      console.log("token: ", token, tokenContract)
      if (
        token &&
        tokenContract &&
        token.name === "" &&
        token.symbol === "" &&
        token.decimals === 0
      ) {
        console.log("fetching token info...")
        const name = readFieldCompressedString(
          (await tokenContract.methods.public_get_name().simulate()) as any,
        )

        const symbol = readFieldCompressedString(
          (await tokenContract.methods.public_get_symbol().simulate()) as any,
        )

        const decimals = await tokenContract.methods.public_get_decimals().simulate()

        setToken({
          address: token.address,
          name: name,
          symbol: symbol,
          decimals: Number(decimals),
        })
        localStorage.setItem("token", JSON.stringify(token))
      } else {
        localStorage.setItem("token", JSON.stringify(token))
      }
    }

    loadToken()
  }, [token, tokenContract])

  const handleAddToken = async () => {
    setError(null)
    console.log("adding token...")
    console.log("account: ", account)
    console.log("tokenContract: ", tokenContract)

    if (!token) {
      setError("Token not found")
      return
    }

    await sdk.watchAssets([
      {
        type: "ARC20",
        options: {
          address: token.address,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
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

    if (!token) {
      setError("Token contract not found")
      return
    }

    if (!tokenContract) {
      setError("Token contract not found")
      return
    }

    try {
      const [privateBalance, publicBalance] = await Promise.all([
        tokenContract.methods.balance_of_private(account.getAddress()).simulate(),
        tokenContract.methods.balance_of_public(account.getAddress()).simulate(),
      ])

      console.log("privateBalance: ", privateBalance)
      console.log("publicBalance: ", publicBalance)

      setPublicBalance(formatUnits(BigInt(publicBalance.toString()), token.decimals))
      setPrivateBalance(formatUnits(BigInt(privateBalance.toString()), token.decimals))
    } catch (e) {
      setError("Error fetching balances")
      console.error("Error fetching balances: ", e)
    }
  }

  useEffect(() => {
    if (account && tokenContract) {
      handleFetchBalances()
    }
  }, [account, tokenContract])

  useEffect(() => {
    if (token && account && token.decimals > 0) {
      const initTokenContract = async () => {
        try {
          const tokenContract = await Token.at(AztecAddress.fromString(token.address), account)
          setTokenContract(tokenContract)
        } catch (e) {
          console.error("Error initializing token contract: ", e)
        }
      }
      initTokenContract()
    }
  }, [token, account])

  const handleSendTx = async (isPrivate: boolean, withAuthWitness: boolean = false) => {
    setLoading(true)
    setError(null)
    if (!account) {
      setError("Account not found")
      setLoading(false)
      return
    }

    if (!token) {
      setError("Token not found")
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
                parseUnits(amount.toString(), token.decimals),
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
                parseUnits(amount.toString(), token.decimals),
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
        parseUnits(amount.toString(), token.decimals),
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
    setError(null)

    if (!account) {
      setError("Account not found")
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const deployTx = await Token.deploy(account, account.getAddress(), "Token", "TEST", 18n)
        .send()
        .wait()

      console.log("deployTx: ", deployTx)

      const tokenContract = deployTx.contract
      const mintPrivateTx = await tokenContract.methods
        .mint_to_private(account.getAddress(), account.getAddress(), 1000e18)
        .request()
      const mintPublicTx = await tokenContract.methods
        .mint_to_public(account.address, 1000e18)
        .request()

      const batchedTx = new BatchCall(account, [mintPrivateTx, mintPublicTx], {
        registerContracts: [
          {
            address: tokenContract.address,
            instance: tokenContract.instance,
            artifact: TokenContractArtifact,
          },
        ],
      })
      const batchedTxHash = await batchedTx.send().wait()
      console.log("batchedTxHash: ", batchedTxHash)

      const token = await Token.at(tokenContract.address, account)
      setTokenContract(token)

      setToken({
        address: tokenContract.address.toString(),
        name: "TEST",
        symbol: "TEST",
        decimals: 18,
      })
    } catch (e) {
      setError("Error minting token")
      console.error("Error minting token: ", e)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveToken = async () => {
    setError(null)
    setToken(null)
    setTokenContract(null)
    localStorage.removeItem("token")
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
          {tokenContract && token ? (
            <>
              <Text size="sm">Token: {token.address}</Text>
              <div style={{ display: "flex", gap: 10 }}>
                <Text>
                  Private Balance: {privateBalance ? `${privateBalance} ${token.symbol}` : "0"}
                </Text>
                <Text>
                  Public Balance: {publicBalance ? `${publicBalance} ${token.symbol}` : "0"}
                </Text>
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
                <Button color="gray" mt={10} onClick={() => handleRemoveToken()}>
                  Remove Token
                </Button>
              </div>
              {error && <Text color="red">{error}</Text>}
            </>
          ) : (
            <>
              <Text mt={20}>Use any deployed token or deploy TEST token</Text>
              <TextInput
                label="Token Address"
                style={{ width: "50%" }}
                placeholder="0x..."
                value={token?.address || ""}
                onChange={(e) => {
                  setToken({
                    address: e.target.value,
                    name: "",
                    symbol: "",
                    decimals: 0,
                  })
                  localStorage.setItem("token", JSON.stringify(token))
                }}
              />
              <div style={{ display: "flex", gap: 20 }}>
                <Button mt={10} disabled={loading} onClick={() => handleMintToken()}>
                  Deploy & Mint TEST Token
                </Button>
              </div>
              {error && <Text color="red">{error}</Text>}
            </>
          )}
          <Button color="gray" mt={10} onClick={() => sdk.disconnect()}>
            Disconnect
          </Button>
        </>
      ) : (
        <Button
          onClick={async () => {
            console.log("connecting...")
            const account = await sdk.connect("obsidion")
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
