import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/shieldedPool";
import { IndexedMerkleTree } from "../../../src/runtime/modules/utils";
import { JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/jointTxZkProgram";
import { Note, NoteStore } from "../../../src/runtime/modules/types";
import { PrivateKey, PublicKey, Field, MerkleWitness, Poseidon } from "o1js";
import { TokenId, UInt64 } from "@proto-kit/library";

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
  const witnesses = inputs.map((input) => {
    const serialized = input;
    const commitment = Poseidon.hash([
      serialized.amount,
      serialized.blinding,
      serialized.pubkey,
    ]);
    const index = merkleTree.addLeaf(commitment); // Set the leaf
    return new MyMerkleWitness(merkleTree.getWitness(index));
  });

  // Prepare transaction inputs
  const transactionInput = {
    privateKeys: inputs.map(() => privateKey),
    inputAmounts: inputs.map((i) => i.amount),
    blindings: inputs.map((i) => i.blinding),
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
  const appChain = TestingAppChain.fromRuntime({ ShieldedPool });
  appChain.configurePartial({
    Runtime: {
      Balances: { totalSupply: UInt64.from(10000) },
      ShieldedPool: {},
    },
  });

  await appChain.start();

  return {
    appChain,
    async runTx(sender: PublicKey, callback: () => Promise<void>) {
      const tx = await appChain.transaction(sender, callback);
      await tx.sign();
      await tx.send();
    },
  };
}

describe("ShieldedPool Transactions", () => {
  it(
    "should deposit",
    async () => {
      const alicePrivateKey = PrivateKey.random();
      const alice = alicePrivateKey.toPublicKey();
      const tokenId = TokenId.from(0);

      const { appChain, runTx } = await setupAppChain();

      appChain.setSigner(alicePrivateKey);

      const shieldedPool = appChain.runtime.resolve("ShieldedPool");
      const merkleTree = new IndexedMerkleTree(treeHeight);
      const store = new NoteStore(alicePrivateKey);

      const transactionInput = deposit(store, 1500n);

      // Final root after adding all commitments
      const finalRoot = merkleTree.getRoot();

      // Set the Merkle root in the runtime module
      await runTx(alice, async () => {
        await shieldedPool.setRoot(finalRoot);
      });

      // Verify the stored root matches the final root
      const storedRoot = await shieldedPool.root.get();
      storedRoot.value.assertEquals(
        finalRoot,
        "Mismatch between stored and final Merkle root",
      );

      // Generate a valid proof
      const proof =
        await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

      // Process the transaction

      await runTx(alice, async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });

      // Verify the transaction was successful
      const block1 = await appChain.produceBlock();
      expect(block1?.transactions[0].status.toBoolean()).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "should withdraw",
    async () => {
      const alicePrivateKey = PrivateKey.random();
      const alice = alicePrivateKey.toPublicKey();
      const tokenId = TokenId.from(0);

      const { appChain, runTx } = await setupAppChain();

      appChain.setSigner(alicePrivateKey);

      const shieldedPool = appChain.runtime.resolve("ShieldedPool");
      const merkleTree = new IndexedMerkleTree(treeHeight);

      const store = new NoteStore(alicePrivateKey);
      store.addNote(0n, Note.new(alice, 1000n));
      store.addNote(0n, Note.new(alice, 2000n));

      const transactionInput = withdraw(store, 1500n);

      // Final root after adding all commitments
      const finalRoot = merkleTree.getRoot();

      // Set the Merkle root in the runtime module
      await runTx(alice, async () => {
        await shieldedPool.setRoot(finalRoot);
      });

      // Verify the stored root matches the final root
      const storedRoot = await shieldedPool.root.get();
      storedRoot.value.assertEquals(
        finalRoot,
        "Mismatch between stored and final Merkle root",
      );

      // Generate a valid proof
      const proof =
        await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

      // Process the transaction
      await runTx(alice, async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });

      // Verify the transaction was successful
      const block1 = await appChain.produceBlock();
      expect(block1?.transactions[0].status.toBoolean()).toBe(true);
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
      const { appChain, runTx } = await setupAppChain();

      appChain.setSigner(alicePrivateKey);
      const shieldedPool = appChain.runtime.resolve("ShieldedPool");

      const merkleTree = new IndexedMerkleTree(treeHeight);

      const store = new NoteStore(alicePrivateKey);

      store.addNote(0n, Note.new(alice, 1000n));
      store.addNote(0n, Note.new(alice, 2000n));

      const transactionInput = transfer(store, bob, 1500n);

      // Final root after adding all commitments
      const finalRoot = merkleTree.getRoot();

      // Set the Merkle root in the runtime module
      await runTx(alice, async () => {
        await shieldedPool.setRoot(finalRoot);
      });

      // Verify the stored root matches the final root
      const storedRoot = await shieldedPool.root.get();
      storedRoot.value.assertEquals(
        finalRoot,
        "Mismatch between stored and final Merkle root",
      );

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

      // Attempt to reuse the same nullifiers (should fail)
      await runTx(alice, async () => {
        await shieldedPool.processTransaction(tokenId, proof);
      });

      // Verify the transaction failed due to duplicate nullifiers
      const block2 = await appChain.produceBlock();
      expect(block2?.transactions[0].status.toBoolean()).toBe(false);
    },
    TIMEOUT,
  ); // Set a high timeout
});
