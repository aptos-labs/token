import { AptosClient, HexString, MaybeHexString, BCS } from "aptos";

export const MAINNET_BUNDLR_URL = "https://node1.bundlr.network";
export const TESTNET_BUNDLR_URL = "https://devnet.bundlr.network";
export const MAINNET_APTOS_URL = "https://mainnet.aptoslabs.com/v1";
export const TESTNET_APTOS_URL = "https://fullnode.testnet.aptoslabs.com/v1";

export async function detectNetwork(
  address: MaybeHexString,
): Promise<"mainnet" | "testnet"> {
  try {
    const client = new AptosClient(MAINNET_APTOS_URL);
    await client.getAccount(address);
    return "mainnet";
    // eslint-disable-next-line no-empty
  } catch (e) {}

  try {
    const client = new AptosClient(TESTNET_APTOS_URL);
    await client.getAccount(address);
    return "testnet";
    // eslint-disable-next-line no-empty
  } catch (e) {}

  throw new Error(
    `Address ${HexString.ensure(address).hex()} cannot be found.`,
  );
}

export function dateTimeStrToUnixSecs(dateTimeStr: string): number {
  const date = new Date(dateTimeStr);
  const timestampInMs = date.getTime();
  return Math.floor(timestampInMs / 1000);
}

// Replace with the SDK's implementation
export function getPropertyValueRaw(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  values: Array<string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  types: Array<string>,
): Array<BCS.Bytes> {
  return [];
}
