-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" VARCHAR(10) NOT NULL,
    "block_number" BIGINT NOT NULL,
    "contract_address" VARCHAR(66) NOT NULL,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metadata" (
    "id" VARCHAR(20) NOT NULL,
    "value" VARCHAR(128) NOT NULL,

    CONSTRAINT "Metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT,
    "controller" TEXT NOT NULL,
    "voting_delay" BIGINT NOT NULL,
    "min_voting_period" BIGINT NOT NULL,
    "max_voting_period" BIGINT NOT NULL,
    "proposal_threshold" BIGINT NOT NULL,
    "quorum" DOUBLE PRECISION NOT NULL,
    "strategies" TEXT[],
    "strategies_params" TEXT[],
    "authenticators" TEXT[],
    "executors" TEXT[],
    "proposal_count" INTEGER NOT NULL,
    "vote_count" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "tx" TEXT NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "space_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "execution_hash" TEXT NOT NULL,
    "metadata_uri" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "discussion" TEXT NOT NULL,
    "execution" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "min_end" INTEGER NOT NULL,
    "max_end" INTEGER NOT NULL,
    "snapshot" INTEGER NOT NULL,
    "strategies" TEXT[],
    "strategies_params" TEXT[],
    "scores_1" DOUBLE PRECISION NOT NULL,
    "scores_2" DOUBLE PRECISION NOT NULL,
    "scores_3" DOUBLE PRECISION NOT NULL,
    "scores_total" DOUBLE PRECISION NOT NULL,
    "created" INTEGER NOT NULL,
    "tx" TEXT NOT NULL,
    "vote_count" INTEGER NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "voter_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "proposal" INTEGER NOT NULL,
    "choice" INTEGER NOT NULL,
    "vp" DOUBLE PRECISION NOT NULL,
    "created" INTEGER NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "proposal_count" INTEGER NOT NULL,
    "vote_count" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
