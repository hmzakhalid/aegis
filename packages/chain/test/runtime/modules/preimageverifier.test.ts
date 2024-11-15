import { TestingAppChain } from "@proto-kit/sdk";
import { PreimageVerifier } from "../../../src/runtime/modules/preImageVerifier";
import { PreimageZkProgram } from "../../../src/runtime/modules/preimageZkProgram";
import { log } from "@proto-kit/common";
import { PrivateKey, Field, Poseidon } from "o1js";
import { UInt64 } from "@proto-kit/library";

log.setLevel("ERROR");

describe("PreimageVerifier with Commitments", () => {
  it("should verify the correct proof with commitment and reject invalid proofs", async () => {
    // Initialize the testing app chain with the PreimageVerifier module 
    const appChain = TestingAppChain.fromRuntime({
      PreimageVerifier,
    });
    appChain.configurePartial({
      Runtime: {
        PreimageVerifier: {},
        Balances: {
          totalSupply: UInt64.from(10000),
        },
      },
    });

    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();

    await appChain.start();
    appChain.setSigner(alicePrivateKey);

    // Compile the zk program
    await PreimageZkProgram.compile();

    // Example private key, amount, and blinding
    const privateKey = PrivateKey.random();
    const amount = Field(1000);
    const blinding = Field(12345);

    // Compute the expected public key and commitment
    const expectedPublicKey = privateKey.toPublicKey();
    const expectedCommitment = Poseidon.hash([amount, blinding, expectedPublicKey.toFields()[0]]);

    // Generate a valid proof for the private key, amount, and blinding
    const proof = await PreimageZkProgram.provePreimage(privateKey, amount, blinding);

    // Initialize PreimageVerifier module
    const preimageVerifier = appChain.runtime.resolve("PreimageVerifier");

    // Create a transaction to set the expected public key and commitment
    const tx1 = await appChain.transaction(alice, async () => {
      await preimageVerifier.setExpectedValues(expectedPublicKey, expectedCommitment);
    });

    await tx1.sign();
    await tx1.send();

    // Verify the transaction was successful
    const block1 = await appChain.produceBlock();
    expect(block1?.transactions[0].status.toBoolean()).toBe(true);

    // Create a transaction to verify the valid proof
    const tx2 = await appChain.transaction(alice, async () => {
      await preimageVerifier.verifyProof(proof);
    });

    await tx2.sign();
    await tx2.send();

    // Verify the transaction was successful
    const block2 = await appChain.produceBlock();
    expect(block2?.transactions[0].status.toBoolean()).toBe(true);

    // Test with an invalid proof (random private key and commitment)
    const randomPrivateKey = PrivateKey.random();
    const invalidProof = await PreimageZkProgram.provePreimage(
      randomPrivateKey,
      Field(2000),
      Field(54321)
    );

    const tx3 = await appChain.transaction(alice, async () => {
      await preimageVerifier.verifyProof(invalidProof);
    });

    await tx3.sign();
    await tx3.send();

    // Verify the transaction failed
    const block3 = await appChain.produceBlock();
    expect(block3?.transactions[0].status.toBoolean()).toBe(false);
  }, 1_000_000); // Set a high timeout for async operations
});
