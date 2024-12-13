import { useEffect, useState } from "react"
import { Button, Stack, Text, TextInput } from "@mantine/core"
import { AztecAddress, createPXEClient } from "@aztec/aztec.js"
import { ObsidionWalletSDK } from "@obsidion/wallet-sdk"
import { TokenContract } from "@aztec/noir-contracts.js/Token"
import { useAccount } from "./react"
import { getDeployedTestAccountsWallets } from "@aztec/accounts/testing"
import { fallbackOpenPopup } from "./fallback"

const OBSIDON_WALLET_URL = "http://localhost:5173"
const PXE_URL = "http://localhost:8080"
const pxe = createPXEClient(PXE_URL)

const sdk = new ObsidionWalletSDK(pxe, {
  fallbackOpenPopup: fallbackOpenPopup,
  walletUrl: OBSIDON_WALLET_URL,
})

export function Example() {
  const account = useAccount(sdk)

  const [tokenContract, setTokenContract] = useState<TokenContract | null>(null)
  const [tokenAddress, setTokenAddress] = useState<string | null>(null)
  const [amount, setAmount] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (tokenAddress && account) {
      const initTokenContract = async () => {
        const tokenContract = await TokenContract.at(AztecAddress.fromString(tokenAddress), account)
        setTokenContract(tokenContract)
      }
      initTokenContract()
    }
  }, [tokenAddress, account])

  const handleConnect = async () => {
    setLoading(true)
    console.log("window.location.host: ", window.location.host)

    console.log("Clicked!")
    console.log("sdk: ", sdk)

    const account = await sdk.connect()

    console.log("account: ", account)

    if (!account) return
    // setAccount(account);
    setLoading(false)
  }

  const handleDisconnect = async () => {
    await sdk.disconnect()
    setTokenContract(null)
    setTokenAddress(null)
  }

  const handleSendTx = async (isPrivate: boolean) => {
    if (!account) return
    setLoading(true)
    const accs = await getDeployedTestAccountsWallets(pxe)

    if (!tokenContract) return

    if (!amount) return

    console.log("sending token")

    const txHash = await tokenContract
      .withWallet(account)
      .methods[isPrivate ? "transfer_in_private" : "transfer_in_public"](
        account.getAddress(),
        accs[1].getAddress(),
        BigInt(amount) * BigInt(1e18),
        0,
      )
      .send()
      .wait()

    // console.log("txHash: ", txHash.txHash.toString());
    console.log("txHash: ", txHash)
    setLoading(false)
  }

  return (
    <Stack align="center" justify="space-between" gap="md" mt={100}>
      <Text mb={30} size="30px">
        Example App for Token Transfer
      </Text>

      {account ? (
        <>
          <Text size="sm">Account: {account.getAddress().toString()}</Text>

          {tokenContract && tokenAddress ? (
            <>
              <Text size="sm">Token: {tokenAddress}</Text>
              <TextInput
                style={{ width: "50%" }}
                placeholder="Amount"
                value={amount || ""}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <Button mt={10} onClick={() => handleSendTx(true)}>
                  Send Token (Private)
                </Button>
                <Button mt={10} onClick={() => handleSendTx(false)}>
                  Send Token (Public)
                </Button>
              </div>
            </>
          ) : (
            // make the input wider
            <TextInput
              style={{ width: "50%" }}
              placeholder="Token Address"
              value={tokenAddress || ""}
              onChange={(e) => setTokenAddress(e.target.value)}
            />
          )}
          <Button onClick={handleDisconnect}>Disconnect</Button>
        </>
      ) : (
        <>
          <Button onClick={handleConnect}>Connect</Button>
        </>
      )}
      {loading && <Text>Loading...</Text>}
    </Stack>
  )
}
