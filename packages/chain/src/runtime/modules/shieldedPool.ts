import {
  RuntimeModule,
  runtimeMethod,
  runtimeModule,
  state,
} from "@proto-kit/module";
import { State, StateMap, assert } from "@proto-kit/protocol";
import { Field, Bool, PublicKey, PrivateKey } from "o1js";
import { Balance, UInt64, TokenId } from "@proto-kit/library";
import { JoinSplitTransactionProof } from "./jointTxZkProgram";
import { inject } from "tsyringe";
import { Balances } from "./balances";
import { ALL } from "dns";

const midPoint = Field(Field.ORDER / 2n);

function isNegative(field: Field): Bool {
  // Field value is negative if it's greater than Field.ORDER/2
  return field.greaterThan(midPoint);
}

@runtimeModule()
export class ShieldedPool extends RuntimeModule<Record<string, never>> {
  @state() public root = State.from<Field>(Field); // Store Merkle root
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool); // Track used nullifiers

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

    const { nullifiers, root: proofRoot, publicAmount } = proof.publicOutput;
    if (!publicAmount.equals(Field(0))) {
      if (isNegative(publicAmount)) {
        this.balances.transfer(
          tokenId,
          PublicKey.empty(),
          this.transaction.sender.value,
          UInt64.from(publicAmount.neg().toBigInt()),
        );
      } else {
        this.balances.transfer(
          tokenId,
          this.transaction.sender.value,
          PublicKey.empty(),
          UInt64.from(publicAmount.toBigInt()),
        );
      }

    }
  }


//   const currentRoot = await this.root.get();
//   assert(
//     proofRoot.equals(currentRoot.value),
//       "Proof root does not match the current Merkle root",
//     )
//     );
//
// for (const nullifier of nullifiers) {
//   const isNullifierUsed = await this.nullifiers.get(nullifier);
//   assert(isNullifierUsed.value.not(), "Nullifier has already been used");
//   await this.nullifiers.set(nullifier, Bool(true));
// }
//
// await this.root.set(proofRoot);
  }
}
