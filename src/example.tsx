import { useEffect, useState } from "react"
import {
  ActionIcon,
  Button,
  Checkbox,
  CheckIcon,
  CopyButton,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core"
import {
  AztecAddress,
  type ContractArtifact,
  type ContractInstanceWithAddress,
  readFieldCompressedString,
} from "@aztec/aztec.js"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { BatchCall, Contract } from "@nemi-fi/wallet-sdk/eip1193"
import { type IntentAction } from "@nemi-fi/wallet-sdk"
import { useAccount } from "@nemi-fi/wallet-sdk/react"
import { AztecWalletSdk, obsidion } from "@nemi-fi/wallet-sdk"
import { formatUnits, parseUnits } from "viem"
import { DEFAULT_DECIMALS } from "./utils/constants"

class Token extends Contract.fromAztec(TokenContract) {}

//const NODE_URL = "http://localhost:8080"
const NODE_URL = "https://aztec-alpha-testnet-fullnode.zkv.xyz"
//const WALLET_URL = "http://localhost:4173"
const WALLET_URL = "https://app.obsidion.xyz"

const sdk = new AztecWalletSdk({
  aztecNode: NODE_URL,
  connectors: [obsidion({ walletUrl: WALLET_URL })],
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
  const [contractForRegister, setContractForRegister] = useState<{
    address: AztecAddress
    instance: ContractInstanceWithAddress
    artifact: ContractArtifact
  } | null>(null)
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
  const [loadingFetchBalances, setLoadingFetchBalances] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  useEffect(() => {
    const loadToken = async () => {
      console.log("token: ", token, tokenContract)
      if (
        account &&
        token &&
        tokenContract &&
        contractForRegister &&
        token.name === "" &&
        token.symbol === "" &&
        token.decimals === 0
      ) {
        console.log("fetching token info...")

        const [nameResponse, symbolResponse, decimals] = await Promise.all([
          tokenContract.methods.public_get_name({}).simulate(),
          tokenContract.methods.public_get_symbol({}).simulate(),
          tokenContract.methods.public_get_decimals().simulate(),
        ])

        const name = readFieldCompressedString(nameResponse as any)
        const symbol = readFieldCompressedString(symbolResponse as any)

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
    if (loadingFetchBalances) return
    setLoadingFetchBalances(true)
    setError(null)
    console.log("fetching balances...")
    console.log("account: ", account)
    console.log("tokenContract: ", tokenContract)

    if (!account) {
      setError("Account not found")
      setLoadingFetchBalances(false)
      return
    }
    if (!token || token.decimals === 0) {
      setError("Token contract not found")
      setLoadingFetchBalances(false)
      return
    }
    if (!tokenContract) {
      setError("Token contract not found")
      setLoadingFetchBalances(false)
      return
    }
    try {
      const [privateBalance, publicBalance] = await Promise.all([
        tokenContract.methods.balance_of_private(account.getAddress()).simulate(),
        tokenContract.methods.balance_of_public(account.getAddress()).simulate(),
      ])
      console.log("privateBalance: ", privateBalance)
      console.log("publicBalance: ", publicBalance)
      setPublicBalance(formatUnits(publicBalance as bigint, token.decimals))
      setPrivateBalance(formatUnits(privateBalance as bigint, token.decimals))
    } catch (e) {
      setError("Error fetching balances")
      console.error("Error fetching balances: ", e)
    } finally {
      setLoadingFetchBalances(false)
    }
  }

  useEffect(() => {
    if (account && tokenContract && token) {
      handleFetchBalances()
    }
  }, [account, tokenContract, token])

  useEffect(() => {
    if (token && account) {
      const initTokenContract = async () => {
        try {
          const tokenContract = await Token.at(AztecAddress.fromString(token.address), account)
          setTokenContract(tokenContract)
          setContractForRegister({
            address: tokenContract.address,
            instance: tokenContract.instance,
            artifact: TokenContractArtifact,
          })
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
    setTxHash(null)

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

      const tx = await tokenContract.methods[
        isPrivate ? "transfer_in_private" : "transfer_in_public"
      ](
        account.getAddress(),
        AztecAddress.fromString(recipient),
        parseUnits(amount.toString(), token.decimals),
        0,
        withAuthWitness ? { authWitnesses: authwitRequests } : undefined,
      )
        .send()
        .wait({
          timeout: 200000,
        })
      console.log("tx: ", tx)

      setTxHash(tx.txHash.toString())
      console.log("fetching balances after sending tx")
      handleFetchBalances()
    } catch (e) {
      console.error("Error sending transaction: ", e)
      setError("Error sending transaction")
      return
    } finally {
      setLoading(false)
    }
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
      const deployTx = await Token.deploy(
        account,
        account.getAddress(),
        "Token",
        "TEST",
        DEFAULT_DECIMALS,
      )
        .send()
        .wait({
          timeout: 200000,
        })

      console.log("deployTx: ", deployTx)

      const tokenContract = deployTx.contract
      const mintPrivateTx = await tokenContract.methods
        .mint_to_private(account.getAddress(), account.getAddress(), 1000e18)
        .request()
      const mintPublicTx = await tokenContract.methods
        .mint_to_public(account.address, 1000e18)
        .request()

      const batchedTx = new BatchCall(account, [mintPrivateTx, mintPublicTx])
      const batchedTxHash = await batchedTx.send().wait({
        timeout: 200000,
      })
      console.log("batchedTxHash: ", batchedTxHash)

      const token = await Token.at(tokenContract.address, account)
      setTokenContract(token)

      setToken({
        address: tokenContract.address.toString(),
        name: "TEST",
        symbol: "TEST",
        decimals: DEFAULT_DECIMALS,
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
    <Stack
      align="center"
      justify="space-between"
      gap="md"
      style={{ maxWidth: "800px", margin: "0 auto", padding: "24px" }}
    >
      {/* Header Section */}
      <div
        style={{
          textAlign: "center",
          marginBottom: "12px",
          borderBottom: "1px solid #eaeef3",
          paddingBottom: "20px",
          width: "100%",
        }}
      >
        <Text size="30px" style={{ fontWeight: 500, marginBottom: "16px" }}>
          Example Token App
        </Text>
        <Text size="16px" color="dimmed" style={{ marginBottom: "16px" }}>
          This is an example token app that demonstrates app integration with Obsidion Wallet.
        </Text>

        {/* Configuration Information */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "24px",
            marginTop: "16px",
            fontSize: "12px",
            color: "#868e96",
          }}
        >
          <div>
            <span style={{ fontWeight: 500 }}>Node URL:</span> {NODE_URL}
          </div>
          <div>
            <span style={{ fontWeight: 500 }}>Wallet URL:</span> {WALLET_URL}
          </div>
        </div>
      </div>

      {/* Account Display */}
      {account ? (
        <div style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#f8f9fa",
              padding: "10px 16px",
              borderRadius: "8px",
              width: "50%",
              margin: "0 auto",
              marginBottom: "32px",
            }}
          >
            <Text size="md" w={500}>
              Connected:{" "}
            </Text>
            <Text size="md" color="dimmed" mx={8}>
              {shortenAddress(account.getAddress().toString())}
            </Text>
            <CopyButton value={account.getAddress().toString()} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied" : "Copy"} withArrow position="right">
                  <ActionIcon color={copied ? "blue" : "gray"} onClick={copy} ml={4}>
                    <CheckIcon size={12} />
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </div>

          {tokenContract && token ? (
            <>
              {/* Token Info Card */}
              <div
                style={{
                  border: "1px solid #eaeef3",
                  borderRadius: "12px",
                  overflow: "hidden",
                  marginBottom: "24px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#f8f9fa",
                    padding: "12px 20px",
                    borderBottom: "1px solid #eaeef3",
                  }}
                >
                  <Text size="lg" w={600}>
                    Token Information
                  </Text>
                </div>

                <div style={{ padding: "20px" }}>
                  {/* Token name, symbol and decimals row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: "16px",
                      flexWrap: "wrap",
                      gap: "8px",
                    }}
                  >
                    <Text size="xl" style={{ fontWeight: 700, marginRight: "8px" }}>
                      {token.name}
                    </Text>
                    <div
                      style={{
                        backgroundColor: "#e9ecef",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        maxWidth: "80px",
                        textAlign: "center",
                      }}
                    >
                      <Text size="sm" style={{ fontWeight: 600 }}>
                        {token.symbol}
                      </Text>
                    </div>
                    <div
                      style={{
                        marginLeft: "auto",
                        backgroundColor: "#f1f3f5",
                        padding: "4px 8px",
                        borderRadius: "4px",
                      }}
                    >
                      <Text size="sm" color="dimmed">
                        Decimals: {token.decimals}
                      </Text>
                    </div>
                  </div>

                  {/* Token address section */}
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "12px",
                      backgroundColor: "#f8f9fa",
                      borderRadius: "8px",
                      border: "1px solid #eaeef3",
                    }}
                  >
                    <Text size="sm" color="dimmed" mb={4}>
                      Token Address
                    </Text>
                    <Text
                      size="sm"
                      style={{
                        wordBreak: "break-all",
                        fontFamily: "monospace",
                      }}
                    >
                      {token.address}
                    </Text>
                  </div>

                  {/* Balance section - split clearly into two cards */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    {/* Private Balance Card */}
                    <div
                      style={{
                        padding: "16px",
                        backgroundColor: "#f1f3f5",
                        borderRadius: "8px",
                        textAlign: "center",
                      }}
                    >
                      <Text size="sm" color="dimmed" mb={8}>
                        Private Balance
                      </Text>
                      <Text size="lg" style={{ fontWeight: 600 }}>
                        {privateBalance ? privateBalance : "0"} {token.symbol}
                      </Text>
                    </div>

                    {/* Public Balance Card */}
                    <div
                      style={{
                        padding: "16px",
                        backgroundColor: "#f1f3f5",
                        borderRadius: "8px",
                        textAlign: "center",
                      }}
                    >
                      <Text size="sm" color="dimmed" mb={8}>
                        Public Balance
                      </Text>
                      <Text size="lg" style={{ fontWeight: 600 }}>
                        {publicBalance ? publicBalance : "0"} {token.symbol}
                      </Text>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "12px",
                      marginTop: "16px",
                    }}
                  >
                    <Button
                      size="sm"
                      variant="light"
                      disabled={loadingFetchBalances}
                      onClick={() => handleFetchBalances()}
                    >
                      Refresh Balances
                    </Button>
                    <Button size="sm" variant="light" onClick={() => handleAddToken()}>
                      Add to Wallet
                    </Button>
                  </div>
                </div>
              </div>

              {/* Transfer Section */}
              <div
                style={{
                  border: "1px solid #eaeef3",
                  borderRadius: "12px",
                  overflow: "hidden",
                  marginBottom: "24px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#f8f9fa",
                    padding: "12px 20px",
                    borderBottom: "1px solid #eaeef3",
                  }}
                >
                  <Text size="lg" w={600}>
                    Transfer Tokens
                  </Text>
                </div>

                <div style={{ padding: "20px" }}>
                  <TextInput
                    label="Recipient Address"
                    placeholder="0x..."
                    value={recipient || ""}
                    onChange={(e) => setRecipient(e.target.value)}
                    styles={{
                      root: { marginBottom: "16px" },
                      label: { marginBottom: "8px", fontWeight: 500 },
                    }}
                  />

                  <TextInput
                    label="Amount"
                    placeholder="Enter amount to send"
                    value={amount || ""}
                    onChange={(e) => setAmount(e.target.value)}
                    mb={16}
                    styles={{
                      root: { marginBottom: "16px" },
                      label: { marginBottom: "8px", fontw: 500 },
                    }}
                  />

                  <Checkbox
                    label="Include Auth Witness (for demo purposes)"
                    checked={withAuthWitness}
                    onChange={(e) => setWithAuthWitness(e.target.checked)}
                    styles={{ label: { fontSize: "14px" } }}
                    mb={20}
                  />

                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      justifyContent: "center",
                    }}
                  >
                    <Button disabled={loading} onClick={() => handleSendTx(true, withAuthWitness)}>
                      Send Private
                    </Button>
                    <Button
                      variant="light"
                      disabled={loading}
                      onClick={() => handleSendTx(false, withAuthWitness)}
                    >
                      Send Public
                    </Button>
                  </div>

                  {error && (
                    <div
                      style={{
                        backgroundColor: "#fff5f5",
                        color: "#e03131",
                        padding: "12px",
                        borderRadius: "6px",
                        marginTop: "16px",
                      }}
                    >
                      <Text size="sm">{error}</Text>
                    </div>
                  )}
                  {txHash && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        gap: "2px",
                        textAlign: "center",
                        padding: "12px",
                        marginTop: "16px",
                      }}
                    >
                      <Text size="sm" color="dimmed">
                        Transaction Hash:{" "}
                      </Text>
                      <Text size="sm" color="dimmed">
                        {shortenAddress(txHash)}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Token Setup Card */}
              <div
                style={{
                  border: "1px solid #eaeef3",
                  borderRadius: "12px",
                  overflow: "hidden",
                  marginBottom: "24px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#f8f9fa",
                    padding: "12px 20px",
                    borderBottom: "1px solid #eaeef3",
                  }}
                >
                  <Text size="lg" w={600}>
                    Token Setup
                  </Text>
                </div>

                <div style={{ padding: "20px" }}>
                  <Text mb={16} style={{ textAlign: "center" }}>
                    Use any deployed token or deploy a new TEST token
                  </Text>

                  <TextInput
                    label="Token Address"
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
                    styles={{
                      root: { marginBottom: "20px" },
                      label: { marginBottom: "8px", fontWeight: 500 },
                    }}
                  />

                  <Text size="sm" color="dimmed" mb={16} style={{ textAlign: "center" }}>
                    - OR -
                  </Text>

                  <div style={{ textAlign: "center" }}>
                    <Button disabled={loading} onClick={() => handleMintToken()}>
                      🪙 Deploy & Mint TEST Token
                    </Button>
                  </div>

                  {error && (
                    <div
                      style={{
                        backgroundColor: "#fff5f5",
                        color: "#e03131",
                        padding: "12px",
                        borderRadius: "6px",
                        marginTop: "16px",
                      }}
                    >
                      <Text size="sm">{error}</Text>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Loading Indicator */}
          {loading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                marginTop: "20px",
              }}
            >
              <Loader size="sm" />
              <Text ml={10} size="sm" color="dimmed">
                Processing transaction...
              </Text>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <Button size="sm" variant="subtle" color="gray" onClick={() => handleRemoveToken()}>
                Remove Token
              </Button>

              {/* Disconnect Button */}
              <div style={{ textAlign: "center" }}>
                <Button variant="subtle" color="gray" onClick={() => sdk.disconnect()}>
                  Disconnect Wallet
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Not Connected State
        <div
          style={{
            width: "100%",
            padding: "40px 20px",
            textAlign: "center",
            borderRadius: "12px",
            border: "1px dashed #dee2e6",
            backgroundColor: "#f8f9fa",
          }}
        >
          <Text mb={24} size="lg">
            Connect your wallet to get started
          </Text>
          <Button
            size="lg"
            onClick={async () => {
              console.log("connecting...")
              const account = await sdk.connect("obsidion")
              console.log("account: ", account)
            }}
          >
            Connect Wallet
          </Button>
        </div>
      )}
    </Stack>
  )
}

export function shortenAddress(address: string) {
  return address.substring(0, 10) + "..." + address.substring(address.length - 10)
}
