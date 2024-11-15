import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/shieldedPool";
import { IndexedMerkleTree } from "../../../src/runtime/modules/utils";
import { JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/jointTxZkProgram";
import {
  PrivateKey,
  PublicKey,
  Field,
  MerkleTree,
  MerkleWitness,
  Poseidon,
} from "o1js";
import { UInt64 } from "@proto-kit/library";

const randomInt = () => Math.floor(Math.random() * 1000);
const pubkeyToField = (pk: PublicKey) => pk.toFields()[0];
const privateKeyToField = (pk: PrivateKey) => pk.toFields()[0];

type Note = {
  pubkey: Field;
  blinding: Field;
  amount: Field;
};

const treeHeight = 8;
class MyMerkleWitness extends MerkleWitness(treeHeight) { }


function createTxInput(
  privateKey: PrivateKey,
  merkleTree: IndexedMerkleTree,
  inputs: Note[],
  outputs: Note[],
  publicAmount: Field,
) {
  const witnesses = inputs.map((input, i) => {
    const publicKey = input.pubkey;
    const commitment = Poseidon.hash([input.amount, input.blinding, publicKey]);
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

    const inputs = [
      {
        pubkey: pubkeyToField(alice),
        amount: Field(1000),
        blinding: Field(randomInt()),
      },
      {
        pubkey: pubkeyToField(alice),
        amount: Field(2000),
        blinding: Field(randomInt()),
      },
    ];

    const outputs = [
      {
        pubkey: pubkeyToField(bob),
        amount: Field(1500),
        blinding: Field(randomInt()),
      },
      {
        pubkey: pubkeyToField(alice),
        amount: Field(1500),
        blinding: Field(randomInt()),
      },
    ];


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
