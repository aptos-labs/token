import fs from "fs";
import path from "path";
import untildify from "untildify";

export const MAINNET_BUNDLR_URL = "https://node1.bundlr.network";
export const TESTNET_BUNDLR_URL = "https://devnet.bundlr.network";
export const MAINNET_APTOS_URL = "https://mainnet.aptoslabs.com/v1";
export const TESTNET_APTOS_URL = "https://fullnode.testnet.aptoslabs.com/v1";
export const MAINNET = "mainnet";
export const TESTNET = "testnet";
export type NetworkType = "mainnet" | "testnet";

export function dateTimeStrToUnixSecs(dateTimeStr: string): number {
  const date = new Date(dateTimeStr);
  const timestampInMs = date.getTime();
  return Math.floor(timestampInMs / 1000);
}

export function readProjectConfig(project: string): any {
  const projectPath = project || ".";

  const configBuf = fs.readFileSync(resolvePath(projectPath, "config.json"));

  return JSON.parse(configBuf.toString("utf8"));
}

export function resolvePath(p: string, ...rest: string[]): string {
  if (!p) return "";
  return path.resolve(untildify(p), ...rest);
}
