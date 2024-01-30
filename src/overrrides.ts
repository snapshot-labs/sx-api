import { validateAndParseAddress } from 'starknet';

export const networkNodeUrl =
  process.env.NETWORK_NODE_URL ||
  'https://starknet-goerli.infura.io/v3/46a5dd9727bf48d4a132672d3f376146';

const mainnetConfig = {
  manaRpcUrl: 'https://mana.pizza/stark_rpc/0x534e5f4d41494e',
  factoryAddress: '0x250e28c97e729842190c3672f9fcf8db0fc78b8080e87a894831dc69e4f4439',
  propositionPowerValidationStrategyAddress:
    '0x1b28f95cbc5bcbe52014ef974d609f14497517f31d3c9e079a2464edf988751',
  herodotusStrategies: [
    '0x7ee3cf64f1072fe21570356eb57d4e9f78169ea9235ba610f60a8b33c36cc6e',
    '0x699e53f4b40e19d96b8020386dbeeb156f40172d7bbb78b2a4204cf64ae75f'
  ],
  startBlock: 445498
};

const goerliConfig = {
  manaRpcUrl: 'https://mana.pizza/stark_rpc/0x534e5f474f45524c49',
  factoryAddress: '0x63c62258e1ba4d9ad72eab809ea5c3d1a4545b721bc444d6068ced6246c2f3c',
  propositionPowerValidationStrategyAddress:
    '0x3ff398ab4e0aa9109c0cc889ff968c6215053a5e2176519b59f8ba87927c631',
  herodotusStrategies: [
    '0x1b3cbb267de6d0f30ddf521cd385a2e11836f0c5ba6f7b2224cf77a6ed86acf',
    '0x35dbd4e4f46a059557e1b299d17f4568b49488bad5da9a003b171d90052139e'
  ],
  startBlock: 907731
};

const sepoliaConfig = {
  manaRpcUrl: 'https://mana.pizza/stark_rpc/0x534e5f5345504f4c4941',
  factoryAddress: '0x0302d332e9aceb184e5f301cb62c85181e7fc3b30559935c5736e987de579f6e',
  propositionPowerValidationStrategyAddress:
    '0x296e1a5ad28c9bf32b9570d6e1bedae77917866cd5d92aea4ef9271905ef549',
  herodotusStrategies: [
    '0x6df976878be613837f120529c6f630374f1fd65a9bd4ffdbc2b0f135b5edd2e',
    '0x1f8544918b5d9b4833fb2ba2d0c7ceb0d699ae7f2b8b23ea129c9a10fe8046c'
  ],
  startBlock: 17960
};

let networkProperties = goerliConfig;
if (process.env.NETWORK === 'SN_MAIN') networkProperties = mainnetConfig;
if (process.env.NETWORK === 'SN_SEPOLIA') networkProperties = sepoliaConfig;

networkProperties.herodotusStrategies = networkProperties.herodotusStrategies.map(strategy =>
  validateAndParseAddress(strategy)
);

export { networkProperties };
