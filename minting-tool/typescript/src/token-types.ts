import { HexString, TxnBuilderTypes } from "aptos";

declare type PropertyMap = { [key: string]: [type: string, value: any] };

export function getMutabilityConfig(
  config: any,
  expectedNumber: number,
): boolean[] {
  if (config === undefined) {
    return new Array(expectedNumber).fill(false);
  }
  return (config as boolean[]).length === expectedNumber
    ? config
    : new Array(expectedNumber).fill(false);
}

export class RoyaltyConfig {
  public creators: [TxnBuilderTypes.AccountAddress, number][];

  constructor(creators: [TxnBuilderTypes.AccountAddress, number][]) {
    this.creators = creators;
  }
}

export class CollectionData {
  public name: string;

  public filePath: string;

  public assetMetadata: string;

  public description: string;

  public supply: number;

  public maximum: number;

  public mutate_config: boolean[];

  constructor(
    name: string,
    filePath: string,
    assetMetadata: string,
    description: string,
    supply: number,
    maximum: number,
    mutateConfig: boolean[],
  ) {
    this.name = name || "";
    this.filePath = filePath || "";
    this.assetMetadata = assetMetadata || "";
    this.description = description || "";
    this.supply = supply || 0;
    this.maximum = maximum || 0;
    this.mutate_config = getMutabilityConfig(mutateConfig, 3);
  }
}

export class TokenData {
  public name: string;

  public filePath: string;

  public assetMetadata: string;

  public description: string;

  public supply: number;

  public royaltyWeights: RoyaltyConfig;

  public maximum: number;

  public defaultProperties: PropertyMap;

  public mutateConfig: boolean[];

  public royaltyNumerator: number;

  public royaltyDenominator: number;

  public royaltyPayeeAccount: HexString;

  constructor(
    name: string,
    filePath: string,
    assetMetadata: string,
    description: string,
    royaltyWeights: RoyaltyConfig,
    supply: number,
    maximum: number,
    mutateConfig: boolean[],
    properties: PropertyMap,
    royaltyNumerator: number,
    royaltyDenominator: number,
    royaltyPayeeAccount: HexString,
  ) {
    this.name = name || "";
    this.filePath = filePath || "";
    this.assetMetadata = assetMetadata || "";
    this.description = description || "";
    this.royaltyWeights = royaltyWeights; // if cannot get right value, leave to be undefined
    this.supply = supply || 0;
    this.maximum = maximum || 0;
    this.mutateConfig = getMutabilityConfig(mutateConfig, 5);
    this.defaultProperties = properties || {};
    this.royaltyNumerator = royaltyNumerator || 0;
    this.royaltyDenominator = royaltyDenominator || 0;
    this.royaltyPayeeAccount = royaltyPayeeAccount;
  }
}

export class Token {
  public tokenData: TokenData;

  public propertyVersion: number;

  public amount: number;

  constructor(tokenData: TokenData, propertyVersion: number, amount: number) {
    this.tokenData = tokenData;
    this.propertyVersion = propertyVersion || 0;
    this.amount = amount || 0;
  }
}

export class CollectionConfig {
  public collectionData: CollectionData;

  public tokens: Token[];

  constructor(collectionData: CollectionData, tokens: Token[]) {
    this.collectionData = collectionData;
    this.tokens = tokens;
  }
}
