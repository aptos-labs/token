/* eslint-disable no-console */
import { TokenMill } from "../token-mill";
import { BundlrUploader } from "../asset-uploader";
import { fullNodeUrl, getTestAccount } from "./test-account.test";

test(
  "test generating nfts",
  async () => {
    const alice = getTestAccount();

    const uploader = new BundlrUploader(alice);
    if (process.env.ADD_FUND) {
      await uploader.fund("10000000"); // fund 0.1 apt to bundlr
    }
    const bundlr = await uploader.bundlrPromise;
    const balance = await bundlr.getLoadedBalance();
    console.log("Alice's bundlr balance: ", balance);
    const mill = new TokenMill(
      "./src/tests/assets",
      alice,
      fullNodeUrl,
      uploader,
    );
    await mill.run();
  },
  60 * 1000,
);
