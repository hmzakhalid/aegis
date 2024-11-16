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
  @state() public root = State.from<Field>(Field); // Store Merkle root
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool); // Track used nullifiers

  @runtimeMethod()
  public async setRoot(root: Field) {
    await this.root.set(root);
  }

  @runtimeMethod()
  public async processTransaction(proof: JoinSplitTransactionProof) {
    proof.verify();

    const { nullifiers, root: proofRoot } = proof.publicOutput;

    const currentRoot = await this.root.get();
    assert(
      proofRoot.equals(currentRoot.value),
      "Proof root does not match the current Merkle root"
    );

    for (const nullifier of nullifiers) {
      const isNullifierUsed = await this.nullifiers.get(nullifier);
      assert(isNullifierUsed.value.not(), "Nullifier has already been used");
      await this.nullifiers.set(nullifier, Bool(true));
    }

    await this.root.set(proofRoot);
  }
}
