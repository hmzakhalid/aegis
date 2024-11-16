import {
  RuntimeModule,
  runtimeMethod,
  runtimeModule,
  state,
} from "@proto-kit/module";
import { Balance, UInt64, TokenId } from "@proto-kit/library";
import { State, StateMap, assert } from "@proto-kit/protocol";
import { Field, Bool, Provable, PublicKey, PrivateKey } from "o1js";
import { JoinSplitTransactionProof } from "./jointTxZkProgram";
import { inject } from "tsyringe";
import { Balances } from "./balances";

const midPoint = Field(Field.ORDER / 2n);

function isNegative(field: Field) {
  // Field value is negative if it's greater than Field.ORDER/2
  return field.greaterThan(midPoint);
}
let ranpubkey = PrivateKey.random().toPublicKey();

@runtimeModule()
export class ShieldedPool extends RuntimeModule<Record<string, never>> {
  @state() public root = State.from<Field>(Field);
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);

  public constructor(@inject("Balances") private balances: Balances) {
    super();
  }

  @runtimeMethod()
  public async setRoot(root: Field) {
    await this.root.set(root);
  }

  @runtimeMethod()
  public async processTransaction(
    tokenId: TokenId,
    proof: JoinSplitTransactionProof,
  ) {
    proof.verify();
    const {
      nullifiers,
      oldRoot: proofRoot,
      newRoot,
      publicAmount,
    } = proof.publicOutput;

    const currentRoot = (await this.root.get()).value;

    assert(
      proofRoot.equals(currentRoot),
      "Proof Root does not match the new Root",
    );

    let balanceFromBlurg = await this.balances.getBalance(
      tokenId,
      this.transaction.sender.value,
    );

    let hasAmount = Provable.if(
      publicAmount.equals(Field(0)).not(),
      Field(1),
      Field(0),
    );

    let outbound = Provable.if(
      isNegative(publicAmount),
      publicAmount.neg(),
      Field(0),
    );

    let inbound = Provable.if(isNegative(publicAmount), Field(0), publicAmount);

    await this.balances.transfer(
      tokenId,
      PublicKey.empty(),
      this.transaction.sender.value,
      UInt64.Unsafe.fromField(hasAmount.mul(outbound)),
    );

    await this.balances.transfer(
      tokenId,
      this.transaction.sender.value,
      ranpubkey,
      UInt64.Unsafe.fromField(hasAmount.mul(inbound)),
    );

    for (const nullifier of nullifiers) {
      const isNullifierUsed = await this.nullifiers.get(nullifier);
      assert(isNullifierUsed.value.not(), "Nullifier has already been used");
      await this.nullifiers.set(nullifier, Bool(true));
    }

    await this.root.set(newRoot);
  }
}
