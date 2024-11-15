import { TestingAppChain } from "@proto-kit/sdk";
import { ShieldedPool } from "../../../src/runtime/modules/preImageVerifier";
import { JoinSplitTransactionProof, JoinSplitTransactionZkProgram } from "../../../src/runtime/modules/preimageZkProgram";
import { PrivateKey, Field, MerkleMap, Poseidon } from "o1js";
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

    // Set initial Merkle root
    const initialMerkleMap = new MerkleMap();
    const initialRoot = initialMerkleMap.getRoot();

    const tx0 = await appChain.transaction(alice, async () => {
        await shieldedPool.setRoot(initialRoot);
      });
  
    await tx0.sign();
    await tx0.send();

    // Define inputs and outputs for the transaction
    const privateKeys = [PrivateKey.random(), PrivateKey.random()];
    const inputAmounts = [Field(1000), Field(2000)];
    const inputBlindings = [Field(123), Field(456)];
    const outputAmounts = [Field(1500), Field(1500)];
    const outputPubkeys = [Field(789), Field(101112)];
    const outputBlindings = [Field(333), Field(444)];
    const publicAmount = Field(0);

    // Add commitments to the Merkle Map (mock Merkle proof generation)
    const witnesses = privateKeys.map((_, i) => {
      const publicKey = privateKeys[i].toPublicKey().toFields()[0];
      const commitment = Poseidon.hash([inputAmounts[i], inputBlindings[i], publicKey]);
      initialMerkleMap.set(Field(i), commitment); // Add commitment at index i
      return initialMerkleMap.getWitness(Field(i)); // Generate Merkle proof
    });

    // Prepare transaction inputs
    const transactionInput = {
      privateKeys,
      inputAmounts,
      blindings: inputBlindings,
      merkleProofInputs: witnesses,
      merkleProofIndex: [Field(0), Field(1)], // Indices of commitments in the Merkle Map
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
  }, 1_000_000);
});
