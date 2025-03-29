import { persisted } from "svelte-persisted-store";
import { derived, type Readable, type Writable, get } from "svelte/store";
import type { IArtifactStrategy } from "./artifacts.js";
import type { Eip6963ProviderInfo, IConnector } from "./base.js";
import type { TypedEip1193Provider } from "./types.js";
import { METHODS_NOT_REQUIRING_CONFIRMATION } from "./utils.js";
import { BridgeHost, generateECDHKeyPair, type KeyPair } from "@obsidion/bridge";
import type { RpcRequest } from "./types.js";

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
			
			// Use a unique way to track this specific connection attempt
			const connectionAttemptId = Date.now().toString();
			console.log(`Starting connection attempt ${connectionAttemptId} for topic ${state.topic}`);
			
			// Attempt to reconnect using the stored values
			const bridgeConnection = await this.#bridgeHost.connect({
				topic: state.topic,
				keyPair: keyPair
			});
			
			console.log(`Connection attempt ${connectionAttemptId} succeeded`);
			
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
		
		// Otherwise do a fresh connect
		return await this.connect();
	}

	// TODO: should send disconnect message to wallet through bridge
	// or implement a proper handler in wallet when a new connection is being established
	async disconnect() {
		this.#bridgeHost.closeAll();
		this.#bridgeConnection = null;
		this.#connectedAccountAddress.set(null);
		
		// Clear the connection state when explicitly disconnecting
		this.#connectionStateStore.set(null);
	}

	provider: TypedEip1193Provider = {
		request: async (request) => {
			const abortController = new AbortController();
			console.log("request", request);

			if (METHODS_NOT_REQUIRING_CONFIRMATION.includes(request.method)) {
				try {
					console.log("sending request");
					return await this.#sendRequest(request);
				} finally {
					abortController.abort();
				}
			} else {
				console.log("requesting popup");
				return await this.#requestPopup(request);
			}
		},
	};

	async #requestPopup(request: RpcRequest<any>): Promise<any> {
		console.log("requestPopup...: ", request);
		this.#pendingRequestsCount++;

		try {
			console.log("requesting popup");
			// Use existing bridge connection or create a new one
			const bridgeConnection = await this.#getOrCreateConnection();

			console.log("bridge connection established");

			const isRequestAccount = request.method === "aztec_requestAccounts";
			// Open the popup with the bridge URL and topic in the query parameters
			this.#openPopupWithBridgeUrl(bridgeConnection.url, isRequestAccount);

			if (!this.#popup) {
				throw new Error("Failed to open popup. It may have been blocked by the browser.");
			}
					
			console.log("popup ready");
			console.log("bridge connection", bridgeConnection);

			// Wait for secure channel to be established
			await new Promise<void>((resolve) => {
				if (bridgeConnection.isSecureChannelEstablished()) {
					resolve(); // Already established
				} else {
					bridgeConnection.onSecureChannelEstablished(() => {
						console.log("secure channel established (ECDH complete)");
						resolve();
					});
				}
			});

			console.log("secure channel established outer");

			const rpcRequest = {
				id: crypto.randomUUID(),
				jsonrpc: "2.0",
				method: request.method,
				params: request.params || [],
			};

			// Now send the RPC request
			console.log(`Sending popup request:`, rpcRequest);
			await new Promise((resolve) => setTimeout(resolve, 3000)); // Small delay to ensure handler is registered
			const ret = await bridgeConnection.sendSecureMessage("WALLET_RPC", rpcRequest);
			console.log("sendSecureMessage returned", ret);
			const requestId = `${bridgeConnection.topic}-${rpcRequest.id}`;
			console.log("requestId", requestId);

			// Wait for the response promise to resolve and return its value
			return await this.#createResponsePromise(request, requestId, bridgeConnection);
		} finally {
			this.#pendingRequestsCount--;
		 this.#popup = null;

		}
	}

	async #sendRequest(request: RpcRequest<any>): Promise<any> {
		console.log("#sendRequest...: ", request);
		this.#pendingRequestsCount++;

		try {
			// Use existing bridge connection or create a new one
			const bridgeConnection = await this.#getOrCreateConnection();
			console.log("bridgeConnection", bridgeConnection);

			// Wait for secure channel to be established if needed
			await new Promise<void>((resolve) => {
				if (bridgeConnection.isSecureChannelEstablished()) {
					console.log("secure channel already established");
					resolve(); // Already established
				} else {
					bridgeConnection.onSecureChannelEstablished(() => {
						resolve();
					});
				}
			 });

			console.log("secure channel established outer");

			const rpcRequest = {
				id: crypto.randomUUID(),
				jsonrpc: "2.0",
				method: request.method,
				params: request.params || [],
			};

			// Send the actual request
			console.log("sending secure message: ", request.method, request.params);
			const requestId = `${bridgeConnection.topic}-${rpcRequest.id}`;
			console.log("requestId", requestId);

			// Send the request
			await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay to ensure handler is registered
			const ret = await bridgeConnection.sendSecureMessage("WALLET_RPC", rpcRequest);
			console.log("response", ret);

			return await this.#createResponsePromise(request, requestId, bridgeConnection);
		} finally {
			this.#pendingRequestsCount--;
		}
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
						
						// Extract the result
						let result: any;
						if (message.params && message.params.result) {
							result = message.params.result;
						} else if (message.result) {
							result = message.result;
						} else {
							result = message.params || message;
						}

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
					} else {
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

	async #createResponsePromise(request: RpcRequest<any>, requestId: string, bridgeConnection: BridgeConnection): Promise<any> {
		// Ensure the message router is set up
		this.#setupMessageRouter();
  
		return new Promise((resolve, reject) => {
			// Register this request with the message router
			this.#registerRequest(requestId, request.method, resolve, reject);
		});
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

export type RpcResponse = ReturnType<typeof rpcResult> | ReturnType<typeof rpcError>

export function rpcError(
	request: {
		id: unknown
	},
	error: { code: number; message: string },
) {
	return {
		id: request.id,
		jsonrpc: "2.0",
		error,
	}
}

export function rpcResult<T>(
	request: {
		id: unknown
	},
	result: T,
) {
	return {
		id: request.id,
		jsonrpc: "2.0",
		result,
	}
}
