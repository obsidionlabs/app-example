import { ObsidionWalletSDK } from "@obsidion/wallet-sdk";
import { Eip1193Account } from "@obsidion/wallet-sdk/eip1193";
import { useEffect, useState } from "react";

export function useAccount(wallet: ObsidionWalletSDK) {
	const [account, setAccount] = useState<Eip1193Account | undefined>(undefined);

	useEffect(() => {
		const unsubscribe = wallet.accountObservable.subscribe((account) => {
			setAccount(account);
		});
		return () => unsubscribe();
	}, []);

	return account;
}
