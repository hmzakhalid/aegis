import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/shieldedPool";
import { IndexedMerkleTree } from "../../../src/runtime/modules/utils";
import { JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/jointTxZkProgram";
import { Note, SerializedNote } from "../../../src/runtime/modules/types";
import {
  PrivateKey,
  PublicKey,
  Field,
  MerkleTree,
  MerkleWitness,
  Poseidon,
} from "o1js";
import { UInt64 } from "@proto-kit/library";

const privateKeyToField = (pk: PrivateKey) => pk.toFields()[0];
const treeHeight = 8;
class MyMerkleWitness extends MerkleWitness(treeHeight) { }

function createTxInput(
  privateKey: PrivateKey,
  merkleTree: IndexedMerkleTree,
  inputs: Note[],
  outputs: Note[],
  publicAmount: Field,
) {

  const serializedInputs = inputs.map(i => i.serialize());
  const serializedOutputs = outputs.map(i => i.serialize());
  const witnesses = inputs.map((input) => {
    const serialized = input.serialize();
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
    privateKeys: serializedInputs.map(() => privateKey),
    inputAmounts: serializedInputs.map((i) => i.amount),
    blindings: serializedInputs.map((i) => i.blinding),
    merkleWitnesses: witnesses,
    outputAmounts: serializedOutputs.map((o) => o.amount),
    outputPublicKeys: serializedOutputs.map((o) => o.pubkey),
    outputBlindings: serializedOutputs.map((o) => o.blinding),
    publicAmount,
  };

  return transactionInput;
}

describe("ShieldedPool Transactions", () => {
  it("should process valid transactions and reject duplicate nullifiers", async () => {
    await JoinSplitTransactionZkProgram.compile();

    // Initialize the testing app chain with the ShieldedPool module
    const appChain = TestingAppChain.fromRuntime({ ShieldedPool });
    appChain.configurePartial({
      Runtime: {
        Balances: { totalSupply: UInt64.from(10000) },
        ShieldedPool: {},
      },
    });

    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();
    const bobPrivateKey = PrivateKey.random();
    const bob = bobPrivateKey.toPublicKey();

    await appChain.start();
    appChain.setSigner(alicePrivateKey);
    const shieldedPool = appChain.runtime.resolve("ShieldedPool");

    const merkleTree = new IndexedMerkleTree(treeHeight);

    const inputs = [new Note(alice, 1000n), new Note(alice, 2000n)];
    const outputs = [new Note(bob, 1500n), new Note(alice, 1500n)];


    const transactionInput = createTxInput(
      alicePrivateKey,
      merkleTree,
      inputs,
      outputs,
      Field(0),
    );

    // Final root after adding all commitments
    const finalRoot = merkleTree.getRoot();
    // Set the Merkle root in the runtime module
    const tx0 = await appChain.transaction(alice, async () => {
      await shieldedPool.setRoot(finalRoot);
    });
    await tx0.sign();
    await tx0.send();

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
      await shieldedPool.processTransaction(proof);
    });
    await tx1.sign();
    await tx1.send();

    // Verify the transaction was successful
    const block1 = await appChain.produceBlock();
    expect(block1?.transactions[0].status.toBoolean()).toBe(true);

    // Attempt to reuse the same nullifiers (should fail)
    const tx2 = await appChain.transaction(alice, async () => {
      await shieldedPool.processTransaction(proof);
    });
    await tx2.sign();
    await tx2.send();

    // Verify the transaction failed due to duplicate nullifiers
    const block2 = await appChain.produceBlock();
    expect(block2?.transactions[0].status.toBoolean()).toBe(false);
  }, 1_000_000); // Set a high timeout
});
