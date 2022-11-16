import { createHash } from "crypto";
import fs from "fs";

export function calculateContentHash(fpath: string): string {
  const content = fs.readFileSync(fpath);
  return createHash("sha256").update(content).digest("hex");
}
