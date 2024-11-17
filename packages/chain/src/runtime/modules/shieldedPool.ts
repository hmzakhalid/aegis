import {
  RuntimeModule,
  runtimeMethod,
  runtimeModule,
  RuntimeEvents,
  state,
} from "@proto-kit/module";
import { UInt64, TokenId } from "@proto-kit/library";
import { State, StateMap, assert } from "@proto-kit/protocol";
import { Field, Bool, Provable, PublicKey, PrivateKey, Struct } from "o1js";
import { JoinSplitTransactionProof } from "./jointTxZkProgram";
import { inject } from "tsyringe";
import { Balances } from "./balances";

const midPoint = Field(Field.ORDER / 2n);

function isNegative(field: Field) {
  // Field value is negative if it's greater than Field.ORDER/2
  return field.greaterThan(midPoint);
}
let ranpubkey = PrivateKey.random().toPublicKey();

export class NullifierEvent extends Struct({
  nullifier: Field,
}) { }

@runtimeModule()
export class ShieldedPool extends RuntimeModule<Record<string, never>> {
  @state() public root = State.from<Field>(Field);
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);
  @state() public tokenPool = StateMap.from<TokenId, PublicKey>(TokenId, PublicKey);

  public constructor(@inject("Balances") private balances: Balances) {
    super();
  }

  @runtimeMethod()
  public async setRoot(root: Field) {
    await this.root.set(root);
  }
  @runtimeMethod()
  public async setTokenPool(tokenId: TokenId, pool: PublicKey) {
    await this.tokenPool.set(tokenId, pool);
  }

  public events = new RuntimeEvents({
    nullify: NullifierEvent
  })

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

    const pool = await this.tokenPool.get(tokenId);

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
    const inboundAmount = UInt64.Unsafe.fromField(inbound.mul(hasAmount));
    const outboundAmount = UInt64.Unsafe.fromField(outbound.mul(hasAmount));

    await this.balances.transfer(
      tokenId,
      pool.value,
      this.transaction.sender.value,
      outboundAmount,
    );

    await this.balances.transfer(
      tokenId,
      this.transaction.sender.value,
      ranpubkey,
      inboundAmount,
    );

    for (const nullifier of nullifiers) {
      const isNullifierUsed = await this.nullifiers.get(nullifier);
      assert(isNullifierUsed.value.not(), "Nullifier has already been used");
      await this.nullifiers.set(nullifier, Bool(true));
      this.events.emit("nullify", new NullifierEvent({ nullifier }));
    }

    await this.root.set(newRoot);
  }
}
