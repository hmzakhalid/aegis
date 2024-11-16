import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/preImageVerifier";
import { JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/preimageZkProgram";
import { PrivateKey, Field, MerkleTree, MerkleWitness, Poseidon } from "o1js";
import { UInt64 } from "@proto-kit/library";


describe("ShieldedPool Transactions", () => {
  it("should process valid transactions and reject duplicate nullifiers", async () => {
    await JoinSplitTransactionZkProgram.compile();

    // Initialize the testing app chain with the ShieldedPool module
    const appChain = TestingAppChain.fromRuntime({ ShieldedPool });
    appChain.configurePartial({ Runtime: { Balances: { totalSupply: UInt64.from(10000) }, ShieldedPool: {} } });
    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();

    await appChain.start();
    appChain.setSigner(alicePrivateKey);
    const shieldedPool = appChain.runtime.resolve("ShieldedPool");

    const treeHeight = 8;
    class MyMerkleWitness extends MerkleWitness(treeHeight) {}
    const merkleTree = new MerkleTree(treeHeight);

    // Define inputs and outputs for the transaction
    const privateKeys = [PrivateKey.random(), PrivateKey.random()];
    const inputAmounts = [Field(1000), Field(2000)];
    const inputBlindings = [Field(123), Field(456)];
    const outputAmounts = [Field(1500), Field(1500)];
    const outputPubkeys = [Field(789), Field(101112)];
    const outputBlindings = [Field(333), Field(444)];
    const publicAmount = Field(0);

    // Add commitments and generate Merkle proofs
    const witnesses = privateKeys.map((_, i) => {
      const publicKey = privateKeys[i].toPublicKey().toFields()[0];
      const commitment = Poseidon.hash([inputAmounts[i], inputBlindings[i], publicKey]);
      merkleTree.setLeaf(BigInt(i), commitment); // Set the leaf
      return new MyMerkleWitness(merkleTree.getWitness(BigInt(i)));
    });

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
    storedRoot.value.assertEquals(finalRoot, "Mismatch between stored and final Merkle root");

    // Prepare transaction inputs
    const transactionInput = {
      privateKeys,
      inputAmounts,
      blindings: inputBlindings,
      merkleWitnesses: witnesses,
      outputAmounts,
      outputPublicKeys: outputPubkeys,
      outputBlindings,
      publicAmount,
    };

    // Generate a valid proof
    const proof = await JoinSplitTransactionZkProgram.proveTransaction(transactionInput);

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
