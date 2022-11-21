import { BundlrUploader } from "../asset-uploader";
import { getTestAccount } from "./test-account.test";

test(
  "test bundlr upload",
  async () => {
    const alice = getTestAccount();

    const node = new BundlrUploader(alice);

    if (process.env.ADD_FUND) {
      await node.fund("10000000"); // fund 0.1 apt to bundlr
    }

    const res = await node.uploadFile("./src/tests/assets/asset.json");
    expect(res !== undefined);
  },
  60 * 1000,
);
