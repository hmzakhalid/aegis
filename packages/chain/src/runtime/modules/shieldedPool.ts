import {
  RuntimeModule,
  runtimeMethod,
  runtimeModule,
  RuntimeEvents,
  state,
} from "@proto-kit/module";
import { State, StateMap, assert } from "@proto-kit/protocol";
import { Field, Bool, Struct } from "o1js";
import { JoinSplitTransactionProof } from "./jointTxZkProgram";

export class NullifierEvent extends Struct({
  nullifier: Field,
}){}

@runtimeModule()
export class ShieldedPool extends RuntimeModule<Record<string, never>> {
  @state() public root = State.from<Field>(Field);
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);

  @runtimeMethod()
  public async setRoot(root: Field) {
    await this.root.set(root);
  }

  public events = new RuntimeEvents({
    nullify: NullifierEvent
  })

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
      this.events.emit("nullify", new NullifierEvent({ nullifier }));
    }

    await this.root.set(newRoot);

  }
}
