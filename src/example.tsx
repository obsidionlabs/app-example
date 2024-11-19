import { useState } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { AztecAddress, createPXEClient } from "@aztec/aztec.js";
import { ObsidionWalletSDK } from "@obsidion/wallet-sdk";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { useAccount } from "./react";
import { getDeployedTestAccountsWallets } from "@aztec/accounts/testing";
import { toast, ToastContent, ToastOptions } from "react-toastify";

const OBSIDON_WALLET_URL = "http://localhost:5173";
const PXE_URL = "http://localhost:8080";
const pxe = createPXEClient(PXE_URL);
export const fallbackOpenPopup: any = async (openPopup: any) => {
	return new Promise<Window | null>((resolve) => {
		const handleConfirm = () => {
			resolve(openPopup());
			toast.dismiss(toastId);
		};

		const handleCancel = () => {
			resolve(null);
			toast.dismiss(toastId);
		};

		const toastContent: ToastContent = (
			<ConfirmToast onConfirm={handleConfirm} onCancel={handleCancel} />
		);

		const toastOptions: ToastOptions = {
			autoClose: false,
			closeOnClick: false,
			draggable: false,
			// Optional: Customize the toast's appearance
			style: { minWidth: "300px" },
		};

		const toastId = toast(toastContent, toastOptions);
	});
};

const sdk = new ObsidionWalletSDK(pxe, {
	fallbackOpenPopup: fallbackOpenPopup,
	walletUrl: OBSIDON_WALLET_URL,
});

export function Example() {
	// const [account, setAccount] = useState<Eip1193Account | null>(null);
	const account = useAccount(sdk);

	const TOKEN_ADDRESS =
		"0x152c319e1a9cadcbd16e62f3ae240be7cb64dabb1bfdae9c61aadcb7d4b57836";
	const [loading, setLoading] = useState<boolean>(false);

	const handleConnect = async () => {
		setLoading(true);
		console.log("window.location.host: ", window.location.host);

		console.log("Clicked!");
		console.log("sdk: ", sdk);

		const account = await sdk.connect();

		console.log("account: ", account);

		if (!account) return;
		// setAccount(account);
		setLoading(false);
	};

	const handleSendTx = async () => {
		if (!account) return;
		setLoading(true);
		const accs = await getDeployedTestAccountsWallets(pxe);

		const tokenContract = await TokenContract.at(
			AztecAddress.fromString(TOKEN_ADDRESS),
			account
		);
		console.log("sending tokne");

		const txHash = await tokenContract
			.withWallet(account)
			.methods.transfer_public(account.getAddress(), accs[1].getAddress(), 1, 0)
			.send()
			.wait();

		// console.log("txHash: ", txHash.txHash.toString());
		console.log("txHash: ", txHash);
		setLoading(false);
	};

	return (
		<Stack align="center" justify="space-between" gap="md" mt={100}>
			<Text mb={30} size="30px">
				Example App
			</Text>

			{account ? (
				<>
					<Text size="sm">Account: {account.getAddress().toString()}</Text>
					<Button mt={10} onClick={handleSendTx}>
						Send Token
					</Button>
				</>
			) : (
				<>
					<Button onClick={handleConnect}>Connect</Button>
				</>
			)}
			{loading && <Text>Loading...</Text>}
		</Stack>
	);
}

interface ConfirmToastProps {
	onConfirm: () => void;
	onCancel: () => void;
}

const ConfirmToast: React.FC<ConfirmToastProps> = ({ onConfirm, onCancel }) => (
	<div>
		<p>Please confirm the transaction</p>
		<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
			<button
				onClick={onCancel}
				style={{
					background: "red",
					color: "white",
					border: "none",
					padding: "8px 12px",
					cursor: "pointer",
				}}
			>
				Deny
			</button>
			<button
				onClick={onConfirm}
				style={{
					background: "green",
					color: "white",
					border: "none",
					padding: "8px 12px",
					cursor: "pointer",
				}}
			>
				Open Wallet
			</button>
		</div>
	</div>
);
