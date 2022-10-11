import {CollectionData, RoyaltyConfig, TokenData, Token, CollectionConfig} from "./token_types"

export function parseAssetJson(content: string): CollectionConfig {
    let assetConfig = JSON.parse(content);

    // create collection data
    let cd = new CollectionData(
        assetConfig.name,
        assetConfig.file_path,
        assetConfig.asset_metedata,
        assetConfig.description,
        assetConfig.supply,
        assetConfig.maximum ,
        assetConfig.mutability_config,
    );
    // create individual token
    let toks = assetConfig.tokens;
    let tokens: Token[] = [];

    toks.forEach((tok: any) => {
       let tokenData = new TokenData(
           tok.name ,
           tok.file_path,
           tok.asset_metedata,
           tok.description,
           tok.royalty_creator_weights,
           tok.supply,
           tok.maximum,
           tok.token_mutate_setting,
           tok.property_map,
           tok.royalty_points_numerator,
           tok.royalty_points_denominator
       );
       tokens.push(new Token(tokenData, 0, tok.amount))
    });
    // compose the final collection config
    return new CollectionConfig(cd, tokens);
}