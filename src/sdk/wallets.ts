import { ShieldSwapArtifactStrategy } from "./artifacts.js";
import type { AztecWalletSdk } from "./base.js";
import { ObsidionBridgeConnector } from "./obsidion.js";
import { type ReownPopupConnectorOptions } from "./reownPopup.js";

type PartialReownPopupConnectorOptions = Pick<
	ReownPopupConnectorOptions,
| "metadata"
> &
	Partial<Pick<ReownPopupConnectorOptions, "walletUrl" | "artifactStrategy">>;

export function obsidion(params: PartialReownPopupConnectorOptions) {
	return (sdk: AztecWalletSdk) =>
		new ObsidionBridgeConnector({
			...params,
			fallbackOpenPopup: sdk.fallbackOpenPopup,
			walletUrl: params.walletUrl ?? "https://app.obsidion.xyz",
			artifactStrategy:
				params.artifactStrategy ??
				ShieldSwapArtifactStrategy.getDefaultSingleton(),

			uuid: "obsidion",
			name: "Obsidion",
			icon: "https://pbs.twimg.com/profile_images/1849068253685116928/MzTzv03r_400x400.jpg",
		});
}
