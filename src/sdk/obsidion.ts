import { persisted } from "svelte-persisted-store";
import { derived, type Readable, type Writable, get } from "svelte/store";
import type { IArtifactStrategy } from "./artifacts.js";
import type { Eip6963ProviderInfo, IConnector } from "./base.js";
import type {  TypedEip1193Provider } from "./types.js";
import { METHODS_NOT_REQUIRING_CONFIRMATION } from "./utils.js";
import { BridgeHost, generateECDHKeyPair, type KeyPair } from "@obsidion/bridge";

type BridgeConnection = {
	url: string;
	topic: string;
	sendSecureMessage: (method: string, params?: any) => Promise<boolean>;
	onMessageReceived: (callback: (message: any) => void) => void;
	onSecureChannelEstablished: (callback: () => void) => void;
	isSecureChannelEstablished: () => boolean;
};


// Define connection state structure for persistence
type ConnectionState = {
	keyPair: {
		privateKey: number[];
		publicKey: number[];
	};
	topic: string;
	url: string;
};

export class ObsidionBridgeConnector implements IConnector {
	readonly info: Eip6963ProviderInfo;

	#pendingRequestsCount = 0;
	#popup: Window | null = null;
	#bridgeHost: BridgeHost;
	#bridgeConnection: BridgeConnection | null = null;
	#connectionInProgress = false;
	#connectionPromise: Promise<BridgeConnection> | null = null;
	
	// Use persisted stores for connection state
	readonly #connectionStateStore: Writable<string | null>;
	readonly #connectedAccountAddress: Writable<string | null>;
	readonly accountObservable: Readable<string | undefined>;
	readonly artifactStrategy: IArtifactStrategy;
	readonly walletUrl: string;
	readonly #fallbackOpenPopup?: FallbackOpenPopup;

	constructor(params: ObsidionBridgeConnectorOptions) {
		this.info = { uuid: params.uuid, name: params.name, icon: params.icon };
		this.walletUrl = params.walletUrl + "/sign";
		this.artifactStrategy = params.artifactStrategy;
		this.#fallbackOpenPopup = params.fallbackOpenPopup;
		this.#bridgeHost = new BridgeHost();
		
		// Initialize the persisted stores
		this.#connectedAccountAddress = persisted<string | null>(
			`aztec-wallet-connected-address-${params.uuid}`,
			null
		);
		
		// Create a store for the full connection state
		this.#connectionStateStore = persisted<string | null>(
			`aztec-wallet-connection-${params.uuid}`,
			null
		);

		this.accountObservable = derived(
			this.#connectedAccountAddress,
			(x) => x ?? undefined
		);

		  // ADDED: Check if we have a stored address - if not, clear connection state
			const storedAddress = get(this.#connectedAccountAddress);
			if (!storedAddress) {
				console.log("No connected account found, clearing connection state");
				this.#connectionStateStore.set(null);
			} else {
				console.log("Found connected address:", storedAddress);
			}
	}

	async #tryRestoreConnection() {
		console.time("tryRestoreConnection");
		try {
			const stateString = get(this.#connectionStateStore);
			if (!stateString) {
				console.log("No stored connection state found");
				return null;
			}
			
			const state = JSON.parse(stateString) as ConnectionState;
			console.log("Found stored connection state:", state);
			
			if (!state.keyPair || !state.topic || !state.url) {
				console.log("Incomplete connection state, not restoring");
				this.#connectionStateStore.set(null); // Clear invalid state
				return null;
			}
			
			// Check if we're already connected with this topic
			if (
				this.#bridgeConnection && 
				this.#bridgeConnection.topic === state.topic &&
				this.#bridgeConnection.isSecureChannelEstablished()
			) {
				console.log("Already connected with the same topic, reusing connection");
				return this.#bridgeConnection;
			}
			
			console.log("Attempting to restore connection with topic:", state.topic);
			
			// Convert stored key pair to KeyPair object
			const keyPair: KeyPair = {
				privateKey: new Uint8Array(state.keyPair.privateKey),
				publicKey: new Uint8Array(state.keyPair.publicKey)
			};
			
			// Attempt to reconnect using the stored values
			console.time("connect")
			const bridgeConnection = await this.#bridgeHost.connect({
				topic: state.topic,
				keyPair: keyPair
			});
			console.timeEnd("connect")
			
			// Store the restored bridge connection
			this.#bridgeConnection = {
				url: bridgeConnection.url || state.url,
				topic: bridgeConnection.topic,
				sendSecureMessage: bridgeConnection.sendSecureMessage,
				onMessageReceived: bridgeConnection.onMessageReceived,
				onSecureChannelEstablished: bridgeConnection.onSecureChannelEstablished,
				isSecureChannelEstablished: bridgeConnection.isSecureChannelEstablished,
			};
			
			return this.#bridgeConnection;
		} catch (error) {
			console.error("Failed to restore connection:", error);
			// Clear invalid state to prevent future errors
			this.#connectionStateStore.set(null);
			return null;
		} finally {
			console.timeEnd("tryRestoreConnection");
		}
	}

	// Save the current connection state
	#saveConnectionState(keyPair: KeyPair, topic: string, url: string) {
		const state: ConnectionState = {
			keyPair: {
				privateKey: Array.from(keyPair.privateKey),
				publicKey: Array.from(keyPair.publicKey)
			},
			topic,
			url
		};
		
		console.log("Saving connection state:", state);
		this.#connectionStateStore.set(JSON.stringify(state));
	}

	async #createNewConnection() {
		console.time("createNewConnection");
		// Generate a new key pair
		const keyPair = await generateECDHKeyPair();
		
		console.log("Creating new bridge connection");
		const bridgeConnection = await this.#bridgeHost.connect({ keyPair });
		console.log("Bridge connection created:", bridgeConnection);
		
		// Store the connection details in persisted storage
		this.#saveConnectionState(
			keyPair,
			bridgeConnection.topic,
			bridgeConnection.url || ""
		);
		
		// Store the bridge connection for future requests
		this.#bridgeConnection = {
			url: bridgeConnection.url || "",
			topic: bridgeConnection.topic,
			sendSecureMessage: bridgeConnection.sendSecureMessage,
			onMessageReceived: bridgeConnection.onMessageReceived,
			onSecureChannelEstablished: bridgeConnection.onSecureChannelEstablished,
			isSecureChannelEstablished: bridgeConnection.isSecureChannelEstablished,
		};
		console.timeEnd("createNewConnection");
		return this.#bridgeConnection;
	}

	/**
 * Get or create a bridge connection, with proper synchronization
 */
async #getOrCreateConnection(): Promise<BridgeConnection> {
  // If we already have a connection, return it
  if (this.#bridgeConnection) {
    console.log("Using existing bridge connection");
    return this.#bridgeConnection;
  }
  
  // If a connection attempt is already in progress, wait for it
  if (this.#connectionInProgress && this.#connectionPromise) {
    console.log("Connection attempt already in progress, waiting for it to complete");
    return this.#connectionPromise;
  }
  
  // Mark that we're starting a connection attempt
  this.#connectionInProgress = true;
  
  // Create a promise for the connection attempt
  this.#connectionPromise = (async () => {
		console.time("getOrCreateConnection");
    try {
      // First try to restore an existing connection
      const restoredConnection = await this.#tryRestoreConnection();
      if (restoredConnection) {
        this.#bridgeConnection = restoredConnection;
        
        // Set up the message router for the restored connection
        this.#setupMessageRouter();
        
        return restoredConnection;
      }
      
      // If restoration failed, create a new connection
      console.log("No existing connection, creating new one");
      const newConnection = await this.#createNewConnection();
      
      // Set up the message router for the new connection
      this.#setupMessageRouter();
      
      return newConnection;
    } catch (error) {
      this.#connectionStateStore.set(null); // Clear invalid state
      throw error;
    } finally {
      // Mark that the connection attempt is complete
      this.#connectionInProgress = false;
			console.timeEnd("getOrCreateConnection");
    }
  })();
  
  // Wait for the connection attempt to complete
  return this.#connectionPromise;
}

	async connect() {
		console.log("connect");
		try {
			const result = await this.provider.request({
				method: "aztec_requestAccounts",
				params: [],
			});
			console.log("result", result);
			const [address] = result;
			console.log("address", address);

		if (address) {
				this.#connectedAccountAddress.set(address);
				return address;
			}
			return undefined;
		} catch (error) {
			console.error("Failed to connect:", error);
			this.#connectedAccountAddress.set(null);
			this.#connectionStateStore.set(null);
			this.#bridgeConnection = null;
			return undefined;
		}
	}

	async reconnect() {
		// Try to use the persisted connection state
		if (await this.#tryRestoreConnection()) {
			// If we have a stored address, return it
			const storedAddress = get(this.#connectedAccountAddress);
			if (storedAddress) return storedAddress;
		}
	}

	async disconnect() {
		try {
			 const bridgeConnection = await this.#getOrCreateConnection();
						// Wait for secure channel to be established
			 await this.waitForSecureChannel(bridgeConnection);

		  const ret = await bridgeConnection.sendSecureMessage("DISCONNECT", undefined);
		  console.log("disconnect returned", ret);

			this.#bridgeConnection = null;
			this.#connectedAccountAddress.set(null);
			
			// Clear the connection state when explicitly disconnecting
			this.#connectionStateStore.set(null);
			this.#bridgeHost.closeAll();

		} catch (error) {
			console.error("Failed to disconnect:", error);
		}
	}

	provider: TypedEip1193Provider = {
		request: async (request) => {

      console.time("request");
			const abortController = new AbortController();
			console.log("request", request);

			this.#pendingRequestsCount++;

			const bridgeConnection = await this.#getOrCreateConnection();
			console.log("bridge connection established");

			console.timeEnd("request");

			const rpcRequest = {
				id: crypto.randomUUID(),
				jsonrpc: "2.0",
				method: request.method,
				params: request.params || [],
			};

			if (METHODS_NOT_REQUIRING_CONFIRMATION.includes(request.method)) {
				try {
					console.log("sending request");
					return await this.#sendRequest(bridgeConnection, rpcRequest);
				} finally {
					abortController.abort();
				}
			} else {
				console.log("sending popup request");
				return await this.#sendRequestPopup(bridgeConnection, rpcRequest);
			}
	  }
	};

	private async waitForSecureChannel(bridgeConnection: BridgeConnection): Promise<void> {		
		
			// Wait for the secure channel to be established first
			await Promise.race([
				// Approach 1: Use event listener (typically faster)
				new Promise<void>((resolve) => {
					bridgeConnection.onSecureChannelEstablished(() => {
						// Only add a minimal delay (10ms) for state propagation
						setTimeout(resolve, 10)
					})
				}),
	
				// Approach 2: Use polling as backup with faster interval
				new Promise<void>((resolve) => {
					const channelCheckInterval = setInterval(() => {
						if (bridgeConnection.isSecureChannelEstablished()) {
							clearInterval(channelCheckInterval)
							resolve()
						}
					}, 20) // Faster polling interval
	
					// Set a cleanup for the interval
					setTimeout(() => clearInterval(channelCheckInterval), 5000)
				}),
			])
		
		
		// Now wait for the "ready" message from the wallet
		await new Promise<void>((resolve) => {
			// Flag to track if we've received the ready message
			let readyReceived = false;
			
			// Set up a message listener to watch for the "ppp_ready" message
			const messageHandler = (message: any) => {
				console.log("Received message while waiting for ready:", message);
				
				if (message && message.method === "ppp_ready") {
					console.log("Received ready message from wallet");
					readyReceived = true;
					resolve();
				}
			};
			
			// Register the message listener
			bridgeConnection.onMessageReceived(messageHandler);
			
			// Also set up a polling mechanism with timeout
			const maxWaitTime = 10000; // 10 seconds maximum wait
			const startTime = Date.now();
			const readyCheckInterval = setInterval(() => {
				// Check if we've waited too long
				if (Date.now() - startTime > maxWaitTime) {
					clearInterval(readyCheckInterval);
					console.warn("Timed out waiting for ready message, proceeding anyway");
					resolve();
				}
				
				// Extra check for the ready flag
				if (readyReceived) {
					clearInterval(readyCheckInterval);
				}
			}, 100);
			
			// Try to send a ping message to prompt a ready response if needed
			// This might be necessary if the wallet is already running but hasn't sent ready
			setTimeout(async () => {
				if (!readyReceived) {
					console.log("Sending ping to prompt ready message");
					try {
						await bridgeConnection.sendSecureMessage("ping", {});
					} catch (error) {
						console.warn("Error sending ping:", error);
					}
				}
			}, 1000);
		});
		
		// Final verification
		if (!bridgeConnection.isSecureChannelEstablished()) {
			throw new Error("Secure channel could not be established");
		}
		
		// Add a small delay to ensure everything is ready
		await new Promise(resolve => setTimeout(resolve, 100));
		console.log("Secure channel established and wallet ready");
	}

	async #sendRequestPopup(bridgeConnection: BridgeConnection, request: any): Promise<any> {
		console.log("requestPopup...: ", request);
		this.#pendingRequestsCount++;

		try {
			const isRequestAccount = request.method === "aztec_requestAccounts";
			// Open the popup with the bridge URL and topic in the query parameters
			this.#openPopupWithBridgeUrl(bridgeConnection.url, isRequestAccount);

			if (!this.#popup) {
				throw new Error("Failed to open popup. It may have been blocked by the browser.");
			}

			// Ensure the message router is set up
			this.#setupMessageRouter();

			console.time("waitForSecureChannel");
			
			// Wait for secure channel to be established
			await this.waitForSecureChannel(bridgeConnection);
			console.timeEnd("waitForSecureChannel");
			console.log("secure channel established");

			console.log(`Sending popup request:`, request);
			// Wait for the response promise to resolve and return its value
			return await this.#createResponsePromise(request, bridgeConnection);
		} finally {
			this.#pendingRequestsCount--;
		 this.#popup = null;

		}
	}

	async #sendRequest(bridgeConnection: BridgeConnection, request: any): Promise<any> {
		console.log("#sendRequest...: ", request);
		this.#pendingRequestsCount++;

		try {
			// Ensure the message router is set up
		  this.#setupMessageRouter();
			// Wait for secure channel to be established if needed
			await this.waitForSecureChannel(bridgeConnection);
			console.log("secure channel established");
			// Send the actual request
			console.log("sending secure message: ", request.method, request.params);

			// Send the request
			await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay to ensure handler is registered
			return await this.#createResponsePromise(request, bridgeConnection);
		} finally {
			this.#pendingRequestsCount--;
		}
	}

	async #createResponsePromise(rpcRequest:any, bridgeConnection: BridgeConnection): Promise<any> {
		const requestId = `${bridgeConnection.topic}-${rpcRequest.id}`;
		console.log("requestId", requestId);
		try {
			console.time("sendSecureMessage");
			const ret = await bridgeConnection.sendSecureMessage("WALLET_RPC", rpcRequest);
			console.timeEnd("sendSecureMessage");
			console.log("response", ret);
		} catch (error) {
			console.error("Failed to send request:", error);
		}
  
		return new Promise((resolve, reject) => {
			// Register this request with the message router
			this.#registerRequest(requestId, rpcRequest.method, resolve, reject);
		});
	}

	#messageHandlerInitialized = false;
  #registerRequest: (id: string, method: string, resolve: any, reject: any) => void = () => {};

	#setupMessageRouter() {
		// Skip setup if already initialized
		if (this.#messageHandlerInitialized) return;
		
		// Store all pending request handlers
		const pendingRequests = new Map<string, { 
			resolve: (value: any) => void, 
			reject: (reason: any) => void,
			method: string,
			timeout: any
		}>();
		
		console.log("pendingRequests", pendingRequests);
		// Track outgoing request IDs to filter out echoed messages
		const outgoingRequestIds = new Set<string>();
		
		// Create a single message handler for all requests
		const messageHandler = (message: any) => {
			console.log("ROUTER: Message received:", message);
			
			try {
				// Check if this is an outgoing request echo
				if (message && message.method === "WALLET_RPC") {
					// Extract the ID from the outgoing request
					let requestId = null;
					if (message.params && message.params.id) {
						requestId = message.params.id;
					}
					
					// Add to tracking set if it's a new outgoing request
					if (requestId) {
						console.log(`ROUTER: Detected outgoing request ${requestId}, ignoring echo`);
						outgoingRequestIds.add(requestId);
						return; // Skip further processing
					}
				}
				
				// Handle actual responses
				if (message && message.method === "rpc_response") {
					console.log("ROUTER: Found RPC response message", message);
					
					// Extract ID from response
					let requestId: string | undefined;
					if (message.params && message.params.id) {
						requestId = message.params.id;
					} else if (message.id) {
						requestId = message.id;
					} else if (message.params && message.params.result && message.params.result.id) {
						requestId = message.params.result.id;
					}
					
					// Find matching pending request
					if (requestId && pendingRequests.has(requestId)) {
						const { resolve, reject, timeout, method } = pendingRequests.get(requestId)!;
						console.log(`ROUTER: Found handler for request ${requestId} (${method})`);
						
						// Clear timeout
						clearTimeout(timeout);


						const result = message.params.result

						console.log("result", result);
						
						// Check for errors
						if (result && result.error) {
							console.error(`ROUTER: Error in response for ${method}:`, result.error);
							reject(new Error(result.error.message || "Unknown error"));
						} else {
							console.log(`ROUTER: Resolving ${method} with result:`, result);
							resolve(result);
						}
						
						// Remove the handler after processing
						pendingRequests.delete(requestId);
						outgoingRequestIds.delete(requestId); // Clean up tracking
						console.log(`ROUTER: Removed handler for ${requestId}, ${pendingRequests.size} pending requests remain`);
					}	else {
						console.log("ROUTER: No matching handler found for ID:", requestId);
					}
				} else if (message && message.method === "hello") {
					console.log("ROUTER: Received hello message (handshake verification)");
					// Handshake messages don't need specific handler processing
				} else {
					console.log("ROUTER: Message is not an RPC response:", message);
				}
			} catch (e) {
				console.error("ROUTER: Error processing message:", e);
			}
		};
		
		// Set the message handler on the bridge connection
		if (this.#bridgeConnection) {
			this.#bridgeConnection.onMessageReceived(messageHandler);
			this.#messageHandlerInitialized = true;
			console.log("ROUTER: Message router initialized");
		}
		
		// Expose the request registration method
		this.#registerRequest = (id: string, method: string, resolve: any, reject: any) => {
			const timeout = setTimeout(() => {
				console.error(`Request "${method}" (${id}) timed out after 120 seconds`);
				if (pendingRequests.has(id)) {
					pendingRequests.get(id)!.reject(new Error(`Request "${method}" timed out after 120 seconds`));
					pendingRequests.delete(id);
					outgoingRequestIds.delete(id); // Clean up tracking
				}
			}, 120000);
			
			pendingRequests.set(id, { resolve, reject, method, timeout });
			console.log(`ROUTER: Registered handler for ${method} with ID ${id}`);
		};
	}

	#openPopupWithBridgeUrl(connectionUrl: string, overrideConnection: boolean) {
		console.log("opening popup with bridge url");

		const popupUrl = new URL(this.walletUrl);

		let storedConnectionUrl = null;
		try {
			const stateString = get(this.#connectionStateStore);
			if (stateString) {
				const state = JSON.parse(stateString) as ConnectionState;
				console.log("storedConnectionUrl", state.url);
				storedConnectionUrl = state.url;
			}
		} catch (e) {
			console.error("Error parsing stored connection state:", e);
		}
	
		// If the URLs match, use the stored one
		if (storedConnectionUrl !== connectionUrl || overrideConnection)  {
			popupUrl.searchParams.set("connectionUrl", connectionUrl);
		}

		// Create a wallet URL with the bridge parameters
		const left = (window.innerWidth - POPUP_WIDTH) / 2 + window.screenX;
		const top = (window.innerHeight - POPUP_HEIGHT) / 2 + window.screenY;

		const openPopupFunc = () => {
			return window.open(
				popupUrl.toString(),
				"aztec-wallet-popup",
				`width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`
			);
		};

		// Try opening the popup directly
		this.#popup = openPopupFunc();
		this.#popup?.focus();

		// If popup was blocked and we have a fallback method, use it
		if (!this.#popup && this.#fallbackOpenPopup) {
			this.#fallbackOpenPopup(openPopupFunc)
				.then((popup) => {
					this.#popup = popup;
				})
				.catch((error) => {
					console.error("Error opening popup with fallback:", error);
				});
		}
	}
}

export interface ObsidionBridgeConnectorOptions {
	/** EIP-6963 provider UUID */
	readonly uuid: string;
	/** Human readable wallet name */
	readonly name: string;
	/** Icon URL or data URL for the wallet */
	readonly icon: string;
	/** Wallet URL */
	readonly walletUrl: string;
	/** Artifact strategy */
	readonly artifactStrategy: IArtifactStrategy;
	/** Fallback open popup function */
	fallbackOpenPopup?: FallbackOpenPopup;
}

export type FallbackOpenPopup = (
	openPopup: () => Window | null
) => Promise<Window | null>;

const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 540;
