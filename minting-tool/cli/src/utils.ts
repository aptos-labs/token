/* eslint-disable max-len */
import { AptosAccount, HexString } from "aptos";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { exit } from "process";
import untildify from "untildify";
import YAML from "yaml";
import { exec, spawn } from "child_process";

export const OCTAS_PER_APT = 100000000;

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

export async function resolveProfile(
  profileName: string,
): Promise<[AptosAccount, NetworkType]> {
  // Check if Aptos CLI config file exists
  const cliConfigFile = resolvePath(os.homedir(), ".aptos", "config.yaml");
  if (!fs.existsSync(cliConfigFile)) {
    throw new Error(
      "Cannot find the global config for Aptos CLI. Did you forget to run command 'aptos config set-global-config --config-type global && aptos init --profile <profile-name>'?",
    );
  }

  const configBuf = await fs.promises.readFile(cliConfigFile);
  const config = YAML.parse(configBuf.toString("utf8"));
  if (!config?.profiles?.[profileName]) {
    throw new Error(
      `Profile '${profileName}' is not found. Run command 'aptos config show-global-config' to make sure the config type is "Global". Run command 'aptos config show-profiles' to see available profiles.`,
    );
  }

  const profile = config.profiles[profileName];

  if (!profile.private_key || !profile.rest_url) {
    throw new Error(`Profile '${profileName}' format is invalid.`);
  }

  let network = "";

  if (profile.rest_url.includes(TESTNET)) {
    network = TESTNET;
  }

  if (profile.rest_url.includes(MAINNET)) {
    network = MAINNET;
  }

  if (network !== TESTNET && network !== MAINNET) {
    throw new Error(
      `Make sure profile '${profileName}' points to '${TESTNET}' or '${MAINNET}'. Run command 'aptos config show-profiles --profile ${profileName}' to see profile details.`,
    );
  }

  return [
    new AptosAccount(new HexString(profile.private_key).toUint8Array()),
    network,
  ];
}

export function octasToApt(amount: string): string {
  return (Number.parseInt(amount, 10) / 100000000).toFixed(2);
}

export function exitWithError(message: string) {
  console.error(chalk.red(message));
  exit(1);
}

export class MapWithDefault<K, V> extends Map<K, V> {
  private readonly default: () => V;

  get(key: K) {
    if (!this.has(key)) {
      this.set(key, this.default());
    }
    return super.get(key);
  }

  constructor(defaultFunction: () => V) {
    super();
    this.default = defaultFunction;
  }
}

export async function sleep(timeMs: number): Promise<null> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeMs);
  });
}

async function ensureAptosCLIExists() {
  return new Promise((resolve, reject) => {
    exec("aptos --version", (error) => {
      if (error) {
        reject(new Error("The 'aptos' cli is not found."));
        return;
      }

      resolve(undefined);
    });
  });
}

export async function runWithAptosCLI(cmd: string) {
  await ensureAptosCLIExists();

  return new Promise((resolve, reject) => {
    const parts = cmd.split(" ");
    const child = spawn(parts[0], parts.slice(1), {
      stdio: [process.stdin, process.stdout, process.stderr],
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to run ${cmd}`));
      }
      resolve(undefined);
    });
  });
}
