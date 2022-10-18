import { parseAssetJson } from '../input_parser';
import * as fs from 'fs';

test('parse input file', () => {
  let config = parseAssetJson(
    fs.readFileSync('./src/test/test_folder/asset.json', 'utf8')
  );
  expect(config.tokens.length == 2);
});
