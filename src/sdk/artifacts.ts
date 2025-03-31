import type { ContractArtifact } from "@aztec/aztec.js";
import { joinURL } from "ufo";
import type { SerializedContractArtifact } from "./types.js";
import { lazyValue, request } from "./utils.js";

export interface IArtifactStrategy {
  serializeArtifact(
    artifact: ContractArtifact,
  ): Promise<SerializedContractArtifact>;
}

export class LiteralArtifactStrategy implements IArtifactStrategy {
  async serializeArtifact(artifact: ContractArtifact) {
    return {
      type: "literal",
      literal: artifact,
    } satisfies SerializedContractArtifact;
  }
}

export class ShieldSwapArtifactStrategy implements IArtifactStrategy {
  #cachedUrls = new Map<string, Promise<string>>();

  constructor(readonly apiUrl = "https://registry.obsidion.xyz/artifacts") {}

  static getDefaultSingleton = lazyValue(
    () => new ShieldSwapArtifactStrategy(),
  );

  async serializeArtifact(artifact: ContractArtifact) {
    console.time("serializeArtifact");
    const url = await this.#fetchOrUpload(artifact);
    console.timeEnd("serializeArtifact");
    console.log("serializeArtifact url: ", url);
    return {
      type: "url",
      url,
    } satisfies SerializedContractArtifact;
  }

  async #fetchOrUpload(artifact: ContractArtifact) {
    console.time("fetchOrUpload");
    console.time("getContractArtifactId");
    const id = await getContractArtifactId(artifact);
    console.timeEnd("getContractArtifactId");
    let urlPromise = this.#cachedUrls.get(id);
    if (!urlPromise) {
      urlPromise = (async () => {
        let url = await request({
          method: "GET",
          url: joinURL(this.apiUrl, `?id=${id}`),
        });
        if (!url) {
          url = (await request({
            method: "POST",
            url: this.apiUrl,
            body: artifact,
          })) as string;
        }
        return url;
      })();
      this.#cachedUrls.set(id, urlPromise);
    }
    console.timeEnd("fetchOrUpload");
    return urlPromise;
  }
}

export async function getContractArtifactId(artifact: ContractArtifact) {
  const { computeArtifactHash } = await import("@aztec/stdlib/contract");
  return (await computeArtifactHash(artifact)).toString();
}
