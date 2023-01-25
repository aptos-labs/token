import Bundlr from "@bundlr-network/client";
import NodeBundlr from "@bundlr-network/client/build/node/bundlr";
import { AptosAccount } from "aptos";
import BigNumber from "bignumber.js";
import {
  MAINNET_APTOS_URL,
  MAINNET_BUNDLR_URL,
  TESTNET_APTOS_URL,
  TESTNET_BUNDLR_URL,
} from "./utils";

export interface AssetUploader {
  provider: string;

  // Upload content to off-chain storage and return a link
  uploadFile(filePath: string): Promise<any>;
}

export class BundlrUploader implements AssetUploader {
  provider: string;

  bundlrPromise: Promise<NodeBundlr>;

  account: AptosAccount;

  constructor(account: AptosAccount, network: "mainnet" | "testnet") {
    this.provider = "bundlr";
    this.account = account;
    const signingFunction = async (msg: Uint8Array) =>
      this.account.signBuffer(msg).toUint8Array();

    this.bundlrPromise = Bundlr.init({
      url: network === "mainnet" ? MAINNET_BUNDLR_URL : TESTNET_BUNDLR_URL,
      providerUrl:
        network === "mainnet" ? MAINNET_APTOS_URL : TESTNET_APTOS_URL,
      currency: "aptos",
      publicKey: this.account.pubKey().toString(),
      signingFunction,
    });
  }

  async uploadFile(filePath: string): Promise<string> {
    const bundlr = await this.bundlrPromise;

    const res = await bundlr.uploadFile(filePath);
    return res.id;
  }

  async fund(amount: string) {
    const bundlr = await this.bundlrPromise;
    await bundlr.fund(BigNumber(amount));
  }
}
