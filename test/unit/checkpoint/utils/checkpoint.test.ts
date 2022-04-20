import { getContractFromCheckpointConfig } from '../../../../src/checkpoint/utils/checkpoint';
import { validCheckpointConfig } from '../../../fixtures/checkpointConfig.fixture';

describe('getContractFromCheckpointConfig', () => {
  it('should work', () => {
    expect(getContractFromCheckpointConfig(validCheckpointConfig)).toMatchSnapshot();
  });
});
