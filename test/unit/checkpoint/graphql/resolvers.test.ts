import { DeepMockProxy, mock, mockDeep } from 'jest-mock-extended';
import { queryCheckpoints, ResolverContext } from '../../../../src/checkpoint/graphql/resolvers';
import { CheckpointsStore } from '../../../../src/checkpoint/stores/checkpoints';

describe('queryCheckpoints', () => {
  let ctx: DeepMockProxy<ResolverContext> & ResolverContext;

  beforeEach(() => {
    ctx = mockDeep<ResolverContext>();
  });

  it('should work with appropriate defaults', async () => {
    const args = {
      contract: '0x0625dc1290b6e936be5f1a3e963cf629326b1f4dfd5a56738dea98e1ad31b7f3'
    };

    await queryCheckpoints({}, args, ctx);

    expect(ctx.checkpointsStore.getNextCheckpointBlocks.mock.calls).toMatchSnapshot();
  });

  it('should work with custom block arguments', async () => {
    const args = {
      contract: '0x0625dc1290b6e936be5f1a3e963cf629326b1f4dfd5a56738dea98e1ad31b7f3',
      fromBlock: 5100,
      size: 500
    };

    await queryCheckpoints({}, args, ctx);

    expect(ctx.checkpointsStore.getNextCheckpointBlocks.mock.calls).toMatchSnapshot();
  });

  it('should throw if size exceeds allowed max block', async () => {
    const args = {
      contract: '0x0625dc1290b6e936be5f1a3e963cf629326b1f4dfd5a56738dea98e1ad31b7f3',
      size: 500000
    };

    await expect(queryCheckpoints({}, args, ctx)).rejects.toThrowErrorMatchingSnapshot();
  });
});
