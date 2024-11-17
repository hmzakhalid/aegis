import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/shieldedPool";
import { IndexedMerkleTree } from "../../../src/runtime/modules/utils";
import { JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/jointTxZkProgram";
import { Balances } from "../../../src/runtime/modules/balances";
import { Note, Wallet } from "../../../src/runtime/modules/types";
import { PrivateKey, PublicKey, Field, MerkleWitness, Poseidon } from "o1js";
import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";

const TIMEOUT = 1_000_000;

const treeHeight = 8;
class MyMerkleWitness extends MerkleWitness(treeHeight) { }

function createTxInput(
  privateKey: PrivateKey,
  merkleTree: IndexedMerkleTree,
  inputs: Note[],
  outputs: Note[],
  publicAmount: Field,
) {
  let merkleIndexes: bigint[] = [];
  const oldRoot = merkleTree.getRoot();
  const witnesses = outputs.map((output) => {
    const commitment = Poseidon.hash([
      output.amount,
      output.blinding,
      output.pubkey,
    ]);
    const index = merkleTree.addLeaf(commitment); // Set the leaf
    merkleIndexes.push(index);
    return new MyMerkleWitness(merkleTree.getWitness(index));
  });

  const transactionInput = {
    privateKeys: inputs.map(() => privateKey),
    inputAmounts: inputs.map((i) => i.amount),
    blindings: inputs.map((i) => i.blinding),
    oldRoot,
    merkleWitnesses: witnesses,
    outputAmounts: outputs.map((o) => o.amount),
    outputPublicKeys: outputs.map((o) => o.pubkey),
    outputBlindings: outputs.map((o) => o.blinding),
    publicAmount,
    outputs,
    inputs,
    merkleIndexes,
  };

  return transactionInput;
}

function deposit(wallet: Wallet, amount: bigint) {
  let privateKey = wallet.getPrivateKey();
  let publicKey = wallet.getPublicKey();
  let merkleTree = wallet.getMerkleTree();

  let inputs = [Note.new(publicKey, 0n), Note.new(publicKey, 0n)];
  let outputs = [Note.new(publicKey, amount), Note.new(publicKey, 0n)];
  let publicAmount = Field(Number(amount));

  return createTxInput(privateKey, merkleTree, inputs, outputs, publicAmount);
}

function withdraw(wallet: Wallet, amount: bigint) {
  // Retrieve notes up to the required amount
  const [inputs, total] = wallet.getNotesUpTo(amount);

  if (inputs.length === 0) {
    throw new Error("Not enough balance!");
  }

  // Add a zero-amount note if there's only one input
  if (inputs.length === 1) {
    inputs.push(Note.new(wallet.getPublicKey(), 0n));
  }

  const publicKey = wallet.getPublicKey();

  // Calculate the remaining change
  const change = total > amount ? total - amount : 0n;

  // Define output notes
  const outputs = [
    Note.new(publicKey, 0n), // Burned output
    Note.new(publicKey, change), // Remaining change
  ];

  // Retrieve private key and merkle tree
  const privateKey = wallet.getPrivateKey();
  const merkleTree = wallet.getMerkleTree();

  // Negative `publicAmount` indicates withdrawal
  const publicAmount = Field(-1n * amount);

  return createTxInput(privateKey, merkleTree, inputs, outputs, publicAmount);
}


function transfer(wallet: Wallet, to: PublicKey, amount: bigint) {
  const [inputs, total] = wallet.getNotesUpTo(amount);
  if (inputs.length === 0) {
    throw new Error("Not enough balance!");
  }
  if (inputs.length === 1) {
    inputs.push(Note.new(wallet.getPublicKey(), 0n))
  }
  let change = total - amount;
  change = change > 0n ? change : 0n;

  const outputs = [
    Note.new(to, amount),
    Note.new(wallet.getPublicKey(), change),
  ];
  let privateKey = wallet.getPrivateKey();
  let publicAmount = Field(0);
  let merkleTree = wallet.getMerkleTree();
  return createTxInput(privateKey, merkleTree, inputs, outputs, publicAmount);
}

async function setupAppChain() {
  await JoinSplitTransactionZkProgram.compile();

  // Initialize the testing app chain with the ShieldedPool module
  const appChain = TestingAppChain.fromRuntime({ ShieldedPool, Balances });
  appChain.configurePartial({
    Runtime: {
      Balances: { totalSupply: UInt64.from(1_000_000_000) },
      ShieldedPool: {},
    },
  });

  await appChain.start();
  return appChain;
}

async function depositTest() {
  const alice = Wallet.random();
  const pool = Wallet.random();
  const tokenId = TokenId.from(0);
  const appChain = await setupAppChain();
  appChain.setSigner(alice.getPrivateKey());

  const shieldedPool = appChain.runtime.resolve("ShieldedPool");
  const balances = appChain.runtime.resolve("Balances");

  // Final root after adding all commitments
  const initialRoot = alice.getMerkleTree().getRoot();

  // Set the Merkle root in the runtime module
  let tx = await appChain.transaction(alice.getPublicKey(), async () => {
    await shieldedPool.setRoot(initialRoot);
  });
  await tx.sign();
  await tx.send();
  await appChain.produceBlock();

  tx = await appChain.transaction(alice.getPublicKey(), async () => {
    await shieldedPool.setTokenPool(tokenId, pool.getPublicKey());
  });
  await tx.sign();
  await tx.send();
  await appChain.produceBlock();

  tx = await appChain.transaction(alice.getPublicKey(), async () => {
    await balances.addBalance(tokenId, alice.getPublicKey(), Balance.from(100_000n));
  });
  await tx.sign();
  await tx.send();
  await appChain.produceBlock();

  tx = await appChain.transaction(alice.getPublicKey(), async () => {
    await balances.addBalance(tokenId, pool.getPublicKey(), Balance.from(100_000n));
  });
  await tx.sign();
  await tx.send();
  await appChain.produceBlock();

  const { outputs, inputs, merkleIndexes, ...transactionInput } = deposit(
    alice,
    1500n,
  );

  alice.addNotesFromOutputs(outputs, merkleIndexes);

  // Generate a valid proof
  const proof =
    await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

  // Process the transaction
  tx = await appChain.transaction(alice.getPublicKey(), async () => {
    await shieldedPool.processTransaction(tokenId, proof);
  });
  await tx.sign();
  await tx.send();

  // Verify the transaction was successful
  const block1 = await appChain.produceBlock();
  expect(block1?.transactions[0].status.toBoolean()).toBe(true);
  // Consume the block and add nullifier to the wallet
  if (block1) {
    alice.consumeBlock(block1, "nullify");
  } else {
    throw new Error("Block is undefined");
  }

  let total = alice.getBalance();
  expect(Number(total)).toBe(1500);

  return {
    appChain,
    alice,
    shieldedPool,
    pool
  }
};

describe("ShieldedPool Transactions", () => {
  it(
    "should withdraw",
    async () => {
      // Start with a deposit of 1500
      const { appChain, alice, shieldedPool, pool } = await depositTest();
      const tokenId = TokenId.from(0);
      appChain.setSigner(alice.getPrivateKey());

      // Verify wallet's initial state after deposit
      const initialBalance = alice.getBalance();
      expect(Number(initialBalance)).toBe(1500); // Confirm deposit from `depositTest`
      alice.getBalance = () => 0n;

      // Prepare withdrawal transaction input
      const { outputs, inputs, merkleIndexes, ...transactionInput } = withdraw(alice, 1500n);

      alice.addNotesFromOutputs(outputs, merkleIndexes);

      // Generate proof for withdrawal
      const proof =
        await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

      // Process the withdrawal transaction
      let tx = await appChain.transaction(alice.getPublicKey(), async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });
      await tx.sign();
      await tx.send();

      // Verify the transaction was successful
      const block1 = await appChain.produceBlock();
      expect(block1?.transactions[0].status.toBoolean()).toBe(true);

      // Consume the block to update nullifiers in the wallet
      if (block1) {
        alice.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }

      // Verify wallet's state after withdrawal
      expect(alice.getBalance()).toBe(0n); // 1500 - 1500 withdrawn
    },
    TIMEOUT,
  );


  it(
    "should process valid transactions and reject duplicate nullifiers",
    async () => {
      const alice = Wallet.random();
      const bob = Wallet.random();

      const tokenId = TokenId.from(0);
      const appChain = await setupAppChain();

      await appChain.start();
      appChain.setSigner(alice.getPrivateKey());
      const shieldedPool = appChain.runtime.resolve("ShieldedPool");

      // Final root after adding all commitments
      const initialRoot = alice.getMerkleTree().getRoot();
      // Set the Merkle root in the runtime module
      const tx0 = await appChain.transaction(alice.getPublicKey(), async () => {
        await shieldedPool.setRoot(initialRoot);
      });
      await tx0.sign();
      await tx0.send();
      await appChain.produceBlock();

      alice.addNote(0n, Note.new(alice.getPublicKey(), 1000n));
      alice.addNote(0n, Note.new(alice.getPublicKey(), 2000n));

      const transactionInput = transfer(alice, bob.getPublicKey(), 1500n);

      // Generate a valid proof
      const proof =
        await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

      // Process the transaction
      const tx1 = await appChain.transaction(alice.getPublicKey(), async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });
      await tx1.sign();
      await tx1.send();

      // Verify the transaction was successful
      const block1 = await appChain.produceBlock();
      expect(block1?.transactions[0].status.toBoolean()).toBe(true);

      if (block1) {
        alice.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }

      // Attempt to reuse the same nullifiers (should fail)
      const tx2 = await appChain.transaction(alice.getPublicKey(), async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });
      await tx2.sign();
      await tx2.send();

      // Verify the transaction failed due to duplicate nullifiers
      const block2 = await appChain.produceBlock();
      expect(block2?.transactions[0].status.toBoolean()).toBe(false);
    },
    TIMEOUT,
  ); // Set a high timeout
});
