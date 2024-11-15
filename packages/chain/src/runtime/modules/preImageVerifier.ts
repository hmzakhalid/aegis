import {
    RuntimeModule,
    runtimeMethod,
    runtimeModule,
    state,
  } from "@proto-kit/module";
  import { State, assert } from "@proto-kit/protocol";
  import { PublicKey, Field } from "o1js";
  import { PreimageProof } from "./preimageZkProgram";
  
  @runtimeModule()
  export class PreimageVerifier extends RuntimeModule<Record<string, never>> {
    // State to store the expected public key
    @state() public expectedPublicKey = State.from<PublicKey>(PublicKey);
  
    // State to store the expected commitment
    @state() public expectedCommitment = State.from<Field>(Field);
  
    // Set the expected public key and commitment
    @runtimeMethod()
    public async setExpectedValues(publicKey: PublicKey, commitment: Field) {
      await this.expectedPublicKey.set(publicKey);
      await this.expectedCommitment.set(commitment);
    }
  
    // Verify the proof that private key is the preimage of the public key and matches the commitment
    @runtimeMethod()
    public async verifyProof(proof: PreimageProof) {
      // Verify the zk-SNARK proof
      proof.verify();
  
      // Retrieve the public key and commitment from the proof
      const proofPublicKey = proof.publicOutput.publicKey;
      const proofCommitment = proof.publicOutput.commitment;
  
      // Retrieve the expected public key and commitment from the contract state
      const expectedPublicKey = await this.expectedPublicKey.get();
      const expectedCommitment = await this.expectedCommitment.get();
  
      // Assert that the public key and commitment from the proof match the expected values
      assert(
        proofPublicKey.equals(expectedPublicKey.value),
        "Proof does not match the expected public key"
      );
  
      assert(
        proofCommitment.equals(expectedCommitment.value),
        "Proof does not match the expected commitment"
      );
    }
  }
  