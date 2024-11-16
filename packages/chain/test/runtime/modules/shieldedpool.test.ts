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
class MyMerkleWitness extends MerkleWitness(treeHeight) {}

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
    const commitment = output.commitment();
    const index = merkleTree.addLeaf(commitment); // Set the leaf
    console.log({ index });
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
  const [inputs, total] = wallet.getNotesUpTo(amount);
  let publicKey = wallet.getPublicKey();

  if (inputs.length === 0) {
    throw new Error("Not enough balance!");
  }

  if (inputs.length === 1) {
    inputs.push(Note.new(wallet.getPublicKey(), 0n));
  }
  let change = total - amount;
  change = change > 0n ? change : 0n;
  const outputs = [Note.new(publicKey, 0n), Note.new(publicKey, change)];

  let privateKey = wallet.getPrivateKey();
  let publicAmount = Field(-1n * amount);
  let merkleTree = wallet.getMerkleTree();
  return createTxInput(privateKey, merkleTree, inputs, outputs, publicAmount);
}

function transfer(wallet: Wallet, to: PublicKey, amount: bigint) {
  const [inputs, total] = wallet.getNotesUpTo(amount);
  if (inputs.length === 0) {
    throw new Error("Not enough balance!");
  }
  if (inputs.length === 1) {
    inputs.push(Note.new(wallet.getPublicKey(), 0n));
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
      Balances: { totalSupply: UInt64.from(10000000) },
      ShieldedPool: {},
    },
  });

  await appChain.start();
  return appChain;
}

async function depositTest() {
  const alicePrivateKey = PrivateKey.random();
  const alice = alicePrivateKey.toPublicKey();
  const tokenId = TokenId.from(0);
  const appChain = await setupAppChain();
  appChain.setSigner(alicePrivateKey);

  const shieldedPool = appChain.runtime.resolve("ShieldedPool");
  const balances = appChain.runtime.resolve("Balances");
  const wallet = new Wallet(alicePrivateKey);

  // Final root after adding all commitments
  const initialRoot = wallet.getMerkleTree().getRoot();

  // Set the Merkle root in the runtime module
  const tx0 = await appChain.transaction(alice, async () => {
    await shieldedPool.setRoot(initialRoot);
  });
  await tx0.sign();
  await tx0.send();
  await appChain.produceBlock();

  let tx = await appChain.transaction(alice, async () => {
    await balances.addBalance(tokenId, alice, Balance.from(100_000n));
  });
  await tx.sign();
  await tx.send();
  await appChain.produceBlock();

  let balance = await appChain.query.runtime.Balances.balances.get(
    BalancesKey.from(tokenId, alice),
  );

  if (!balance) {
    throw new Error("No balance found for alice!!!");
  }

  const { outputs, inputs, merkleIndexes, ...transactionInput } = deposit(
    wallet,
    1500n,
  );

  wallet.addNotesFromOutputs(outputs, merkleIndexes);

  // Generate a valid proof
  const proof =
    await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

  // Process the transaction
  const tx1 = await appChain.transaction(alice, async () => {
    await shieldedPool.processTransaction(tokenId, proof);
  });
  await tx1.sign();
  await tx1.send();

  // Verify the transaction was successful
  const block1 = await appChain.produceBlock();
  expect(block1?.transactions[0].status.toBoolean()).toBe(true);
  // Consume the block and add nullifier to the wallet
  if (block1) {
    wallet.consumeBlock(block1, "nullify");
  } else {
    throw new Error("Block is undefined");
  }

  let total = wallet.getBalance();
  expect(Number(total)).toBe(1500);

  return {
    appChain,
    wallet,
  };
}

describe("ShieldedPool Transactions", () => {
  it(
    "should withdraw",
    async () => {
      const alicePrivateKey = PrivateKey.random();
      const alice = alicePrivateKey.toPublicKey();

      const tokenId = TokenId.from(0);
      const appChain = await setupAppChain();

      await appChain.start();
      appChain.setSigner(alicePrivateKey);

      const shieldedPool = appChain.runtime.resolve("ShieldedPool");

      const wallet = new Wallet(alicePrivateKey);

      // Final root after adding all commitments
      const initialRoot = wallet.getMerkleTree().getRoot();
      // Set the Merkle root in the runtime module
      const tx0 = await appChain.transaction(alice, async () => {
        await shieldedPool.setRoot(initialRoot);
      });
      await tx0.sign();
      await tx0.send();
      await appChain.produceBlock();

      wallet.addNote(0n, Note.new(alice, 1000n));
      wallet.addNote(0n, Note.new(alice, 2000n));

      const transactionInput = withdraw(wallet, 1500n);
      // Generate a valid proof
      const proof =
        await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

      // Process the transaction
      const tx1 = await appChain.transaction(alice, async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });
      await tx1.sign();
      await tx1.send();

      // Verify the transaction was successful
      const block1 = await appChain.produceBlock();
      expect(block1?.transactions[0].status.toBoolean()).toBe(true);
      // Consume the block and add nullifier to the wallet
      if (block1) {
        wallet.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }
    },
    TIMEOUT,
  );
  it.only(
    "should process valid transactions and reject duplicate nullifiers",
    async () => {
      const { appChain, wallet: alice } = await depositTest();
      const bob = Wallet.random();

      const tokenId = TokenId.from(0);

      const shieldedPool = appChain.runtime.resolve("ShieldedPool");

      const { outputs, inputs, merkleIndexes, ...transactionInput } = transfer(
        alice,
        bob.getPublicKey(),
        1000n,
      );

      alice.addNotesFromOutputs(outputs, merkleIndexes);
      bob.addNotesFromOutputs(outputs, merkleIndexes);

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
        bob.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }

      let alicePrivateBal = alice.getBalance();
      expect(Number(alicePrivateBal)).toBe(500);

      let bobPrivateBal = alice.getBalance();
      expect(Number(bobPrivateBal)).toBe(1000);
    },
    TIMEOUT,
  ); // Set a high timeout
});
