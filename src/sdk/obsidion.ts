import { persisted } from "svelte-persisted-store"
import { derived, type Readable, type Writable, get } from "svelte/store"
import type { IArtifactStrategy } from "./artifacts.js"
import type { Eip6963ProviderInfo, IConnector } from "./base.js"
import type { TypedEip1193Provider } from "./types.js"
import { METHODS_NOT_REQUIRING_CONFIRMATION } from "./utils.js"
import { Bridge, BridgeInterface, KeyPair, generateECDHKeyPair } from "@obsidion/bridge"
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils"
import debug from "debug"

debug.enable("bridge*")

export class ObsidionBridgeConnector implements IConnector {
  readonly info: Eip6963ProviderInfo

  #pendingRequestsCount = 0
  #popup: Window | null = null
  #bridgeConnection: BridgeInterface | null = null
  #connectionLock = false
  #connectionInitPromise: Promise<BridgeInterface> | null = null
  #messageHandlerInitialized = false
  #registerRequest: (id: string, method: string, resolve: any, reject: any) => void = () => {}

  // Use persisted stores for connection state
  readonly #connectedAccountAddress: Writable<string | null>
  readonly accountObservable: Readable<string | undefined>
  readonly artifactStrategy: IArtifactStrategy
  readonly walletUrl: string
  readonly #fallbackOpenPopup?: FallbackOpenPopup

  constructor(params: ObsidionBridgeConnectorOptions) {
    this.info = { uuid: params.uuid, name: params.name, icon: params.icon }
    this.walletUrl = params.walletUrl + "/sign"
    this.artifactStrategy = params.artifactStrategy
    this.#fallbackOpenPopup = params.fallbackOpenPopup

    // Initialize the persisted stores
    this.#connectedAccountAddress = persisted<string | null>(
      `aztec-wallet-connected-address-${params.uuid}`,
      null,
    )

    this.accountObservable = derived(this.#connectedAccountAddress, (x) => x ?? undefined)
  }

  /**
   * Get or create a bridge connection, with proper synchronization
   */
  async #getOrCreateConnection(): Promise<BridgeInterface> {
    // If there's an in-flight connection creation, return that promise
    if (this.#connectionInitPromise) {
      console.log("Using in-flight connection creation promise")
      return this.#connectionInitPromise
    }

    // Wait for any lock to be released - implement a simple spinlock
    while (this.#connectionLock) {
      console.log("Waiting for connection lock to be released")
      await new Promise((resolve) => setTimeout(resolve, 10)) // Short wait
    }

    // Set the lock to prevent concurrent initialization
    this.#connectionLock = true

    try {
      // Double-check conditions after acquiring the lock
      if (this.#bridgeConnection) {
        console.log("Connection created while waiting for lock")
        return this.#bridgeConnection
      }

      if (this.#connectionInitPromise) {
        console.log("Connection promise created while waiting for lock")
        return this.#connectionInitPromise
      }

      // Start a new connection creation process
      console.log("Creating new bridge connection")
      const connectionState = await getConnectionState()

      // Create and store the promise before any async operations
      this.#connectionInitPromise = (async () => {
        try {
          console.log("Starting Bridge.create()")
          const bridgeConnection = await Bridge.create({
            keyPair: connectionState.keyPair,
            resume: connectionState.connected && isRefreshed(),
          })
          console.log("Bridge connection created:", bridgeConnection)

          // Cache the result
          this.#bridgeConnection = bridgeConnection

          if (connectionState.remotePublicKey) {
            console.log("Setting remote public key:", connectionState.remotePublicKey)
            bridgeConnection.setRemotePublicKey(hexToBytes(connectionState.remotePublicKey))
            await bridgeConnection.computeSharedSecret()
          }

          return bridgeConnection
        } catch (error) {
          console.error("Error creating bridge connection:", error)
          // Clear the bridge connection on error
          this.#bridgeConnection = null
          throw error
        } finally {
          // Clear the promise after it completes (success or error)
          this.#connectionInitPromise = null
        }
      })()

      return this.#connectionInitPromise
    } finally {
      // Always release the lock
      this.#connectionLock = false
    }
  }

  async connect() {
    console.log("connect")
    try {
      const result = await this.provider.request({
        method: "aztec_requestAccounts",
        params: [],
      })
      console.log("result", result)
      const [address] = result
      console.log("address", address)

      if (address) {
        this.#connectedAccountAddress.set(address)
        return address
      }
      return undefined
    } catch (error) {
      console.error("Failed to connect:", error)

      this.#popup = null
      this.#pendingRequestsCount = 0
      this.#messageHandlerInitialized = false
      this.#registerRequest = () => {}

      this.#connectionInitPromise = null
      this.#connectedAccountAddress.set(null)
      removeConnectionState()

      // Close and clear the bridge connection
      try {
        this.#bridgeConnection?.close()
      } catch (error) {
        console.error("Failed to close bridge connection:", error)
      }
      this.#bridgeConnection = null

      return undefined
    }
  }

  async reconnect() {
    console.error("Not implemented")
    return undefined
  }

  async disconnect() {
    if (!this.#bridgeConnection) return
    try {
      console.log("Disconnecting bridge connection")

      // Send disconnect message to the wallet
      await this.#bridgeConnection.sendMessage("DISCONNECT", undefined)

      // Clear message handler initialization state
      this.#messageHandlerInitialized = false

      // Reset the request registration function to no-op
      this.#registerRequest = () => {}

      // Close the bridge connection
      this.#bridgeConnection.close()

      // Clear connection references
      this.#bridgeConnection = null
      this.#connectionInitPromise = null

      // Clear popup
      this.#popup = null

      // Clear account information
      this.#connectedAccountAddress.set(null)

      // Remove persisted connection state
      removeConnectionState()

      console.log("Bridge connection fully disconnected")
    } catch (error) {
      console.error("Failed to disconnect:", error)
    } finally {
      // Ensure these are cleared even if there was an error
      this.#bridgeConnection = null
      this.#connectionInitPromise = null
      this.#messageHandlerInitialized = false
    }
  }

  provider: TypedEip1193Provider = {
    request: async (request) => {
      const abortController = new AbortController()
      console.log("request", request)

      if (this.#popup) {
        console.log("can't send request while popup open")
        return
      }

      if (this.#pendingRequestsCount > 20) {
        console.log("can't send request while pending requests count > 20")
        return
      }

      this.#pendingRequestsCount++

      const bridgeConnection = await this.#getOrCreateConnection()
      console.log("bridge connection established")

      const rpcRequest = {
        id: crypto.randomUUID(),
        jsonrpc: "2.0",
        method: request.method,
        params: request.params || [],
      }
      this.#pendingRequestsCount++

      this.#setupMessageRouter(bridgeConnection)

      if (METHODS_NOT_REQUIRING_CONFIRMATION.includes(request.method)) {
        try {
          console.log("sending request")
          return await this.#sendRequest(bridgeConnection, rpcRequest)
        } finally {
          abortController.abort()
        }
      } else {
        console.log("sending popup request")
        return await this.#sendRequestPopup(bridgeConnection, rpcRequest)
      }
    },
  }

  async #sendRequestPopup(bridgeConnection: BridgeInterface, request: any): Promise<any> {
    console.log("requestPopup...: ", request)
    const isRequestAccount = request.method === "aztec_requestAccounts"

    try {
      // Open the popup with the bridge URL and topic in the query parameters
      this.#openPopupWithBridgeUrl(bridgeConnection.connectionString, isRequestAccount)

      if (!this.#popup) {
        throw new Error("Failed to open popup. It may have been blocked by the browser.")
      }

      if (isRequestAccount) {
        await this.waitForSecureChannel(bridgeConnection)
        console.log("secure channel established")
      } else {
        await this.waitForPopupReady(bridgeConnection)
      }

      console.log(`Sending popup request:`, request)
      // Wait for the response promise to resolve and return its value
      return await this.#createResponsePromise(bridgeConnection, request)
    } catch (error) {
      console.error("Failed to send popup request:", error)
      throw error
    } finally {
      this.#pendingRequestsCount--
      this.#popup = null
    }
  }

  async #sendRequest(bridgeConnection: BridgeInterface, request: any): Promise<any> {
    console.log("#sendRequest...: ", request)

    try {
      // Send the request
      await new Promise((resolve) => setTimeout(resolve, 800)) // Small delay to ensure handler is registered
      return await this.#createResponsePromise(bridgeConnection, request)
    } finally {
      this.#pendingRequestsCount--
    }
  }

  private async waitForSecureChannel(bridgeConnection: BridgeInterface): Promise<void> {
    console.log("waitForSecureChannel..")
    // Wait for the secure channel to be established first
    await new Promise<void>((resolve) => {
      bridgeConnection.onSecureChannelEstablished(() => {
        saveRemotePublicKey(bridgeConnection.getRemotePublicKey())
        // Only add a minimal delay (10ms) for state propagation
        setTimeout(resolve, 10)
      })
    })
  }

  private async waitForPopupReady(bridgeConnection: BridgeInterface): Promise<void> {
    console.log("Waiting for popup ready message...")

    await new Promise<void>((resolve) => {
      let isResolved = false
      let readyCheckInterval: ReturnType<typeof setInterval> | null = null

      const messageHandler = (message: any) => {
        if (isResolved) return // Ignore subsequent calls
        console.log("Received message while waiting for ready:", message)

        if (message && message.method === "popup_ready") {
          console.log("Received ready message from wallet")
          if (readyCheckInterval) clearInterval(readyCheckInterval)
          isResolved = true
          resolve()
        } else if (message && message.method === "rpc_response" && message.params?.result?.error) {
          console.log("Received rpc_response error message from wallet")
          if (readyCheckInterval) clearInterval(readyCheckInterval)
          isResolved = true
          resolve()
        }
      }

      // Register the message listener
      bridgeConnection.onMessage(messageHandler)

      const maxWaitTime = 10000 // 10 seconds
      const startTime = Date.now()
      readyCheckInterval = setInterval(() => {
        if (Date.now() - startTime > maxWaitTime) {
          clearInterval(readyCheckInterval!)
          console.warn("Timed out waiting for ready message, proceeding anyway")
          isResolved = true
          resolve()
        }
      }, 100)
    })

    console.log("Done waiting for popup ready")
  }

  async #createResponsePromise(bridgeConnection: BridgeInterface, rpcRequest: any): Promise<any> {
    const requestId = `${bridgeConnection.getPublicKey()}-${rpcRequest.id}`
    console.log("requestId", requestId)

    try {
      const ret = await bridgeConnection.sendMessage("WALLET_RPC", rpcRequest)
      console.log("response", ret)
    } catch (error) {
      console.error("Failed to send request:", error)
    }

    return new Promise((resolve, reject) => {
      // Register this request with the message router
      this.#registerRequest(requestId, rpcRequest.method, resolve, reject)
    })
  }

  #setupMessageRouter(bridgeConnection: BridgeInterface) {
    // Skip setup if already initialized
    if (this.#messageHandlerInitialized) return

    // Store all pending request handlers
    const pendingRequests = new Map<
      string,
      {
        resolve: (value: any) => void
        reject: (reason: any) => void
        method: string
        timeout: any
      }
    >()

    console.log("pendingRequests", pendingRequests)
    // Track outgoing request IDs to filter out echoed messages
    const outgoingRequestIds = new Set<string>()

    // Create a single message handler for all requests
    const messageHandler = (message: any) => {
      console.log("ROUTER: Message received:", message)

      try {
        // Check if this is an outgoing request echo
        if (message && message.method === "WALLET_RPC") {
          // Extract the ID from the outgoing request
          let requestId = null
          if (message.params && message.params.id) {
            requestId = message.params.id
          }

          // Add to tracking set if it's a new outgoing request
          if (requestId) {
            console.log(`ROUTER: Detected outgoing request ${requestId}, ignoring echo`)
            outgoingRequestIds.add(requestId)
            return // Skip further processing
          }
        }

        // Handle actual responses
        if (message && message.method === "rpc_response") {
          console.log("ROUTER: Found RPC response message", message)

          // Extract ID from response
          let requestId: string | undefined
          if (message.params && message.params.id) {
            requestId = message.params.id
          } else if (message.id) {
            requestId = message.id
          } else if (message.params && message.params.result && message.params.result.id) {
            requestId = message.params.result.id
          }

          // Find matching pending request
          if (requestId && pendingRequests.has(requestId)) {
            const { resolve, reject, timeout, method } = pendingRequests.get(requestId)!
            console.log(`ROUTER: Found handler for request ${requestId} (${method})`)

            // Clear timeout
            clearTimeout(timeout)

            const result = message.params.result

            console.log("result", result)

            // Check for errors
            if (result && result.error) {
              console.error(`ROUTER: Error in response for ${method}:`, result.error)
              reject(new Error(result.error.message || "Unknown error"))
            } else {
              console.log(`ROUTER: Resolving ${method} with result:`, result)
              resolve(result)
            }

            // Remove the handler after processing
            pendingRequests.delete(requestId)
            outgoingRequestIds.delete(requestId) // Clean up tracking
            console.log(
              `ROUTER: Removed handler for ${requestId}, ${pendingRequests.size} pending requests remain`,
            )
          } else {
            console.log("ROUTER: No matching handler found for ID:", requestId)
          }
        } else if (message && message.method === "hello") {
          console.log("ROUTER: Received hello message (handshake verification)")
          // Handshake messages don't need specific handler processing
        } else {
          console.log("ROUTER: Message is not an RPC response:", message)
        }
      } catch (e) {
        console.error("ROUTER: Error processing message:", e)
      }
    }

    // Set the message handler on the bridge connection
    if (bridgeConnection) {
      bridgeConnection.onMessage(messageHandler)
      this.#messageHandlerInitialized = true
      console.log("ROUTER: Message router initialized")
    }

    // Expose the request registration method
    this.#registerRequest = (id: string, method: string, resolve: any, reject: any) => {
      const timeout = setTimeout(() => {
        console.error(`Request "${method}" (${id}) timed out after 300 seconds`)
        if (pendingRequests.has(id)) {
          pendingRequests
            .get(id)!
            .reject(new Error(`Request "${method}" timed out after 300 seconds`))
          pendingRequests.delete(id)
          outgoingRequestIds.delete(id) // Clean up tracking
        }
      }, 300000)

      pendingRequests.set(id, { resolve, reject, method, timeout })
      console.log(`ROUTER: Registered handler for ${method} with ID ${id}`)
    }
  }

  #openPopupWithBridgeUrl(connectionUrl: string, overrideConnection: boolean) {
    console.log("opening popup with bridge url")

    const popupUrl = new URL(this.walletUrl)
    if (overrideConnection) {
      popupUrl.searchParams.set("uri", connectionUrl)
    }

    // Create a wallet URL with the bridge parameters
    const left = (window.innerWidth - POPUP_WIDTH) / 2 + window.screenX
    const top = (window.innerHeight - POPUP_HEIGHT) / 2 + window.screenY

    const openPopupFunc = () => {
      return window.open(
        popupUrl.toString(),
        "aztec-wallet-popup",
        `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`,
      )
    }

    // Try opening the popup directly
    this.#popup = openPopupFunc()
    this.#popup?.focus()

    // If popup was blocked and we have a fallback method, use it
    if (!this.#popup && this.#fallbackOpenPopup) {
      this.#fallbackOpenPopup(openPopupFunc)
        .then((popup) => {
          this.#popup = popup
        })
        .catch((error) => {
          console.error("Error opening popup with fallback:", error)
        })
    }
  }
}

export interface ObsidionBridgeConnectorOptions {
  /** EIP-6963 provider UUID */
  readonly uuid: string
  /** Human readable wallet name */
  readonly name: string
  /** Icon URL or data URL for the wallet */
  readonly icon: string
  /** Wallet URL */
  readonly walletUrl: string
  /** Artifact strategy */
  readonly artifactStrategy: IArtifactStrategy
  /** Fallback open popup function */
  fallbackOpenPopup?: FallbackOpenPopup
}

export type FallbackOpenPopup = (openPopup: () => Window | null) => Promise<Window | null>

const POPUP_WIDTH = 420
const POPUP_HEIGHT = 540

type ConnectionState = {
  keyPair: KeyPair
  remotePublicKey: string | null
  connected: boolean
}

let refreshed = true
const isRefreshed = () => {
  const result = refreshed
  console.log("isRefreshed", result)
  refreshed = false
  return result
}

// Replace the separate storage functions with consolidated versions
const STORAGE_KEY = "aztec-wallet-connection-keys"

const saveConnectionKeys = async (keyPair: KeyPair, remotePublicKey?: string | null) => {
  // Get any existing data
  const existingData = localStorage.getItem(STORAGE_KEY)
  let storageObj: any = {}

  if (existingData) {
    try {
      storageObj = JSON.parse(existingData)
    } catch (e) {
      console.error("Failed to parse existing connection keys", e)
    }
  }

  // Update with new key pair
  storageObj.keyPair = {
    privateKey: bytesToHex(keyPair.privateKey),
    publicKey: bytesToHex(keyPair.publicKey),
  }

  // Only update remote public key if provided
  if (remotePublicKey !== undefined) {
    storageObj.remotePublicKey = remotePublicKey
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(storageObj))
}

const saveRemotePublicKey = async (publicKey: string) => {
  const connectionKeys = getConnectionKeys()
  saveConnectionKeys(connectionKeys.keyPair, publicKey)
}

const getConnectionKeys = (): {
  keyPair: KeyPair
  remotePublicKey: string | null
} => {
  const storage = localStorage.getItem(STORAGE_KEY)

  if (storage) {
    try {
      const parsed = JSON.parse(storage)

      // Check if we have valid key pair data
      if (parsed.keyPair?.privateKey && parsed.keyPair?.publicKey) {
        return {
          keyPair: {
            privateKey: hexToBytes(parsed.keyPair.privateKey),
            publicKey: hexToBytes(parsed.keyPair.publicKey),
          },
          remotePublicKey: parsed.remotePublicKey || null,
        }
      }
    } catch (e) {
      console.error("Failed to parse connection keys from storage", e)
    }
  }

  // Return default values if storage is empty or invalid
  return {
    keyPair: { privateKey: new Uint8Array(), publicKey: new Uint8Array() },
    remotePublicKey: null,
  }
}

const getConnectionState = async (): Promise<ConnectionState> => {
  const { keyPair, remotePublicKey } = getConnectionKeys()

  // Initialize key pair if it's empty
  const finalKeyPair = keyPair.privateKey.length === 0 ? await generateECDHKeyPair() : keyPair

  // Save if we generated a new key pair
  if (keyPair.privateKey.length === 0) {
    saveConnectionKeys(finalKeyPair, remotePublicKey)
  }

  return {
    keyPair: finalKeyPair,
    remotePublicKey: remotePublicKey,
    connected: remotePublicKey !== null,
  }
}

const removeConnectionState = async () => {
  localStorage.removeItem(STORAGE_KEY)
}
