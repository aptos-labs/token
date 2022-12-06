import { AptosClient, HexString, MaybeHexString } from "aptos";

export const MAINNET_BUNDLR_URL = "https://node1.bundlr.network";
export const TESTNET_BUNDLR_URL = "https://devnet.bundlr.network";
export const MAINNET_APTOS_URL = "https://mainnet.aptoslabs.com/v1";
export const TESTNET_APTOS_URL = "https://fullnode.testnet.aptoslabs.com/v1";
export const MAINNET = "mainnet";
export const TESTNET = "testnet";

export async function detectNetwork(
  address: MaybeHexString,
): Promise<"mainnet" | "testnet" | "both"> {
  const temp: string[] = [];
  try {
    const client = new AptosClient(MAINNET_APTOS_URL);
    await client.getAccount(address);
    temp.push("mainnet");
    // eslint-disable-next-line no-empty
  } catch (e) {}

  try {
    const client = new AptosClient(TESTNET_APTOS_URL);
    await client.getAccount(address);
    temp.push("testnet");
    // eslint-disable-next-line no-empty
  } catch (e) {}

  if (temp.length === 0) {
    throw new Error(
      `Address ${HexString.ensure(address).hex()} cannot be found.`,
    );
  } else if (temp.length === 1) {
    return temp[0] as "mainnet" | "testnet";
  } else {
    return "both";
  }
}

export function dateTimeStrToUnixSecs(dateTimeStr: string): number {
  const date = new Date(dateTimeStr);
  const timestampInMs = date.getTime();
  return Math.floor(timestampInMs / 1000);
}
