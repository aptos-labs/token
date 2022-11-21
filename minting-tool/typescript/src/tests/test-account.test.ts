import { AptosAccount, HexString } from "aptos";

export const fullNodeUrl = "https://fullnode.testnet.aptoslabs.com/v1";

const testAccountAddress =
  process.env.TEST_ACCOUNT ||
  "0x1c0e7ab8134fd2560774ee2cb61fa50cf762de91c2ede7207cf5536b872e385a";

test("noop", () => {});

export function getTestAccount(): AptosAccount {
  return new AptosAccount(new HexString(testAccountAddress).toUint8Array());
}
