import {
  RuntimeModule,
  runtimeMethod,
  runtimeModule,
  state,
} from "@proto-kit/module";
import { State, StateMap, assert } from "@proto-kit/protocol";
import { Field, Bool, Provable } from "o1js";
import { JoinSplitTransactionProof } from "./jointTxZkProgram";

@runtimeModule()
export class ShieldedPool extends RuntimeModule<Record<string, never>> {
  @state() public root = State.from<Field>(Field);
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);

  @runtimeMethod()
  public async setRoot(root: Field) {
    await this.root.set(root);
  }

  @runtimeMethod()
  public async processTransaction(proof: JoinSplitTransactionProof) {
    proof.verify();
    const { nullifiers, oldRoot: proofRoot, newRoot } = proof.publicOutput;
    const currentRoot = (await this.root.get()).value
    assert(
      proofRoot.equals(currentRoot),
      "Proof Root does not match the new Root"
    )

    for (const nullifier of nullifiers) {
      const isNullifierUsed = await this.nullifiers.get(nullifier);
      assert(isNullifierUsed.value.not(), "Nullifier has already been used");
      await this.nullifiers.set(nullifier, Bool(true));
    }

    await this.root.set(newRoot);

  }
}
