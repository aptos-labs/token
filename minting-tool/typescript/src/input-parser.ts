import {
  CollectionData,
  TokenData,
  Token,
  CollectionConfig,
} from "./token-types";

export function parseAssetJson(content: string): CollectionConfig {
  const assetConfig = JSON.parse(content);

  // create collection data
  const cd = new CollectionData(
    assetConfig.name,
    assetConfig.collection_file_path,
    assetConfig.collection_asset_metadata,
    assetConfig.description,
    assetConfig.supply,
    assetConfig.maximum,
    assetConfig.mutability_config,
  );
  // create individual token
  const toks = assetConfig.tokens;
  const tokens: Token[] = [];

  toks.forEach((tok: any) => {
    const tokenData = new TokenData(
      tok.name,
      tok.token_file_path,
      tok.token_asset_metadata,
      tok.description,
      tok.royalty_creator_weights,
      tok.supply,
      tok.maximum,
      tok.token_mutate_setting,
      tok.property_map,
      tok.royalty_points_numerator,
      tok.royalty_points_denominator,
      tok.royalty_payee_account,
    );
    tokens.push(new Token(tokenData, 0, tok.amount));
  });
  // compose the final collection config
  return new CollectionConfig(cd, tokens);
}
