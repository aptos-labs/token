import * as fs from "fs";
import { parseAssetJson } from "../input-parser";

test("parse input file", () => {
  const config = parseAssetJson(
    fs.readFileSync("./src/test/assets/asset.json", "utf8"),
  );
  expect(config.tokens.length === 2);
});
