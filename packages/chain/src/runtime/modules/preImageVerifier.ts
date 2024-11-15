import {
    RuntimeModule,
    runtimeMethod,
    runtimeModule,
    state,
  } from "@proto-kit/module";
  import { State, StateMap, assert } from "@proto-kit/protocol";
  import { Field, Bool } from "o1js";
  import { JoinSplitTransactionProof } from "./preimageZkProgram";
  
  @runtimeModule()
  export class ShieldedPool extends RuntimeModule<Record<string, never>> {
    // State to store the current Merkle root
    @state() public root = State.from<Field>(Field);
  
    // StateMap to track nullifiers (to prevent double-spends)
    @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);
  
    // Set the Merkle root (typically called when initializing or updating the pool)
    @runtimeMethod()
    public async setRoot(root: Field) {
      await this.root.set(root);
    }
  
    // Process a transaction proof
    @runtimeMethod()
    public async processTransaction(proof: JoinSplitTransactionProof) {
      // Verify the zk-SNARK proof
      proof.verify();
  
      // Retrieve public outputs from the proof
      const { nullifiers, root: proofRoot } = proof.publicOutput;
  
      // Check that the proof's Merkle root matches the stored root
      const currentRoot = await this.root.get();
      assert(
        proofRoot.equals(currentRoot.value),
        "Proof root does not match the current Merkle root"
      );
  
      // Ensure all nullifiers are unused and mark them as used
      for (const nullifier of nullifiers) {
        const isNullifierUsed = await this.nullifiers.get(nullifier);
        assert(isNullifierUsed.value.not(), "Nullifier has already been used");
        await this.nullifiers.set(nullifier, Bool(true));
      }
  
      // Optionally update the Merkle root (if outputs are added to the tree)
      await this.root.set(proofRoot);
    }
  }
  