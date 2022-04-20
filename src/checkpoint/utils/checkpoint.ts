import { CheckpointConfig } from '../types';

export const getContractFromCheckpointConfig = (config: CheckpointConfig): string[] => {
  return config.sources.map(source => source.contract);
};
