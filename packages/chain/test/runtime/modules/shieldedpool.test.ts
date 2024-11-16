import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/shieldedPool";
import { IndexedMerkleTree } from "../../../src/runtime/modules/utils";
import { JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/jointTxZkProgram";
import { Balances } from "../../../src/runtime/modules/balances";
import { Note, NoteStore } from "../../../src/runtime/modules/types";
import {
  PrivateKey,
  PublicKey,
  Field,
  MerkleWitness,
  Poseidon,
  Struct,
} from "o1js";
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
  const oldRoot = merkleTree.getRoot();
  const witnesses = outputs.map((output) => {
    const commitment = Poseidon.hash([
      output.amount,
      output.blinding,
      output.pubkey,
    ]);
    const index = merkleTree.addLeaf(commitment); // Set the leaf
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
  };

  return transactionInput;
}

function deposit(store: NoteStore, amount: bigint) {
  let privateKey = store.getPrivateKey();
  let publicKey = store.getPublicKey();
  let merkleTree = store.getMerkleTree();

  let inputs = [Note.new(publicKey, 0n), Note.new(publicKey, 0n)];
  let outputs = [Note.new(publicKey, amount), Note.new(publicKey, 0n)];

  let publicAmount = Field(Number(amount));

  return createTxInput(privateKey, merkleTree, inputs, outputs, publicAmount);
}

function withdraw(store: NoteStore, amount: bigint) {
  const [inputs, total] = store.getNotesUpTo(amount);
  let publicKey = store.getPublicKey();

  if (inputs.length === 0) {
    throw new Error("Not enough balance!");
  }

  let change = total - amount;
  change = change > 0n ? change : 0n;
  const outputs = [Note.new(publicKey, 0n), Note.new(publicKey, change)];

  let privateKey = store.getPrivateKey();
  let publicAmount = Field(-1n * amount);
  let merkleTree = store.getMerkleTree();
  return createTxInput(privateKey, merkleTree, inputs, outputs, publicAmount);
}

function transfer(store: NoteStore, to: PublicKey, amount: bigint) {
  const [inputs, total] = store.getNotesUpTo(amount);
  if (inputs.length === 0) {
    throw new Error("Not enough balance!");
  }
  let change = total - amount;
  change = change > 0n ? change : 0n;

  const outputs = [
    Note.new(to, amount),
    Note.new(store.getPublicKey(), change),
  ];
  let privateKey = store.getPrivateKey();
  let publicAmount = Field(0);
  let merkleTree = store.getMerkleTree();
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

describe("ShieldedPool Transactions", () => {
  it.only(
    "should deposit",
    async () => {
      const alicePrivateKey = PrivateKey.random();
      const alice = alicePrivateKey.toPublicKey();
      const tokenId = TokenId.from(0);
      const appChain = await setupAppChain();
      appChain.setSigner(alicePrivateKey);

      const shieldedPool = appChain.runtime.resolve("ShieldedPool");
      const balances = appChain.runtime.resolve("Balances");
      const store = new NoteStore(alicePrivateKey);

      // Final root after adding all commitments
      const initialRoot = store.getMerkleTree().getRoot();

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

      const transactionInput = deposit(store, 1500n);

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
      // Consume the block and add nullifier to the store
      if (block1) {
        store.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }
    },
    TIMEOUT,
  );
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

      const store = new NoteStore(alicePrivateKey);

      // Final root after adding all commitments
      const initialRoot = store.getMerkleTree().getRoot();
      // Set the Merkle root in the runtime module
      const tx0 = await appChain.transaction(alice, async () => {
        await shieldedPool.setRoot(initialRoot);
      });
      await tx0.sign();
      await tx0.send();
      await appChain.produceBlock();

      store.addNote(0n, Note.new(alice, 1000n));
      store.addNote(0n, Note.new(alice, 2000n));

      const transactionInput = withdraw(store, 1500n);
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
      // Consume the block and add nullifier to the store
      if (block1) {
        store.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }
    },
    TIMEOUT,
  );
  it(
    "should process valid transactions and reject duplicate nullifiers",
    async () => {
      const alicePrivateKey = PrivateKey.random();
      const alice = alicePrivateKey.toPublicKey();
      const bobPrivateKey = PrivateKey.random();
      const bob = bobPrivateKey.toPublicKey();

      const tokenId = TokenId.from(0);
      const appChain = await setupAppChain();

      await appChain.start();
      appChain.setSigner(alicePrivateKey);
      const shieldedPool = appChain.runtime.resolve("ShieldedPool");
      const store = new NoteStore(alicePrivateKey);

      // Final root after adding all commitments
      const initialRoot = store.getMerkleTree().getRoot();
      // Set the Merkle root in the runtime module
      const tx0 = await appChain.transaction(alice, async () => {
        await shieldedPool.setRoot(initialRoot);
      });
      await tx0.sign();
      await tx0.send();
      await appChain.produceBlock();

      store.addNote(0n, Note.new(alice, 1000n));
      store.addNote(0n, Note.new(alice, 2000n));

      const transactionInput = transfer(store, bob, 1500n);

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
    
      if (block1) {
        store.consumeBlock(block1, "nullify");
      } else {
        throw new Error("Block is undefined");
      }

      // Attempt to reuse the same nullifiers (should fail)
      const tx2 = await appChain.transaction(alice, async () => {
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
