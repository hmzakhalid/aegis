import {
  ZkProgram,
  Struct,
  Poseidon,
  Field,
  PrivateKey,
  MerkleWitness,
} from "o1js";

// Merkle tree configuration
const treeHeight = 8;
class MyMerkleWitness extends MerkleWitness(treeHeight) { }

// Struct for transaction public output
export class TransactionPublicOutput extends Struct({
  nullifiers: [Field, Field],
  commitments: [Field, Field],
  publicAmount: Field,
  newRoot: Field,
  oldRoot: Field,
}) { }

// Struct for transaction private inputs
export class TransactionPrivateInput extends Struct({
  privateKeys: [PrivateKey, PrivateKey],
  inputAmounts: [Field, Field],
  blindings: [Field, Field],
  oldRoot: Field,
  merkleWitnesses: [MyMerkleWitness, MyMerkleWitness],
  outputAmounts: [Field, Field],
  outputPublicKeys: [Field, Field],
  outputBlindings: [Field, Field],
  publicAmount: Field,
}) { }

// Define the JoinSplitTransaction ZkProgram
export const JoinSplitTransactionZkProgram = ZkProgram({
  name: "JoinSplitTransaction",

  publicOutput: TransactionPublicOutput,

  methods: {
    proveTransaction: {
      privateInputs: [TransactionPrivateInput],
      method: async (
        transactionInput: TransactionPrivateInput
      ): Promise<TransactionPublicOutput> => {
        const nullifiers: Field[] = [];
        const commitments: Field[] = [];
        let inputSum = Field(0);
        let outputSum = Field(0);
        // Process inputs to compute nullifiers
        for (let i = 0; i < transactionInput.privateKeys.length; i++) {
          const privateKey = transactionInput.privateKeys[i];
          const amount = transactionInput.inputAmounts[i];
          const blinding = transactionInput.blindings[i];
          const merkleWitness = transactionInput.merkleWitnesses[i];

          const publicKey = privateKey.toPublicKey().toFields()[0];
          const commitment = Poseidon.hash([amount, blinding, publicKey]);
          const witnessIndex = merkleWitness.calculateIndex();


          const nullifier = Poseidon.hash([
            commitment,
            witnessIndex, // Use index as part of the nullifier
            privateKey.toFields()[0],
          ]);
          nullifiers.push(nullifier);

          // Accumulate input amounts
          inputSum = inputSum.add(amount);
        }

        let newRoot = transactionInput.oldRoot;
        // Process outputs to compute commitments
        for (let i = 0; i < transactionInput.outputAmounts.length; i++) {
          const amount = transactionInput.outputAmounts[i];
          const publicKey = transactionInput.outputPublicKeys[i];
          const blinding = transactionInput.outputBlindings[i];
          const merkleWitness = transactionInput.merkleWitnesses[i];

          const commitment = Poseidon.hash([amount, blinding, publicKey]);
          commitments.push(commitment);

          const oldWitnessRoot = merkleWitness.calculateRoot(Field(0));
          newRoot.assertEquals(oldWitnessRoot, "Old root does not match the merkle Witness")
          const currentWitnessRoot = merkleWitness.calculateRoot(commitment);
          newRoot = currentWitnessRoot;

          outputSum = outputSum.add(amount);
        }

        // Verify input-output balance: sum of inputs + publicAmount == sum of outputs
        inputSum.add(transactionInput.publicAmount).assertEquals(outputSum);

        // Return the transaction's public output
        return new TransactionPublicOutput({
          nullifiers: [nullifiers[0], nullifiers[1]],
          commitments: [commitments[0], commitments[1]],
          publicAmount: transactionInput.publicAmount,
          oldRoot: transactionInput.oldRoot,
          newRoot,
        });
      },
    },
  },
});

// Generate the proof class for the ZkProgram
export class JoinSplitTransactionProof extends ZkProgram.Proof(JoinSplitTransactionZkProgram) { }
