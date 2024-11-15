import {
  ZkProgram,
  Struct,
  Poseidon,
  Field,
  Bool,
  MerkleMapWitness,
  PrivateKey,
  MerkleMap,
} from "o1js";

import { TupleN } from "o1js/dist/node/lib/util/types";

// Struct for transaction public output
export class TransactionPublicOutput extends Struct({
  nullifiers: [Field, Field], // Nullifiers for inputs (fixed length: 2)
  commitments: [Field, Field], // Commitments for outputs (fixed length: 2)
  publicAmount: Field,
  root: Field,
}) {}

// Struct for transaction private inputs
export class TransactionPrivateInput extends Struct({
  privateKeys: [PrivateKey, PrivateKey], // Array of private keys for inputs (fixed length: 2)
  inputAmounts: [Field, Field], // Input amounts (fixed length: 2)
  blindings: [Field, Field], // Input blindings (fixed length: 2)
  merkleProofInputs: [MerkleMapWitness, MerkleMapWitness], // Merkle proofs for inputs (fixed length: 2)
  merkleProofIndex: [Field, Field], // Index of the commitment inside the Merkle Map
  outputAmounts: [Field, Field], // Output amounts (fixed length: 2)
  outputPublicKeys: [Field, Field], // Output public keys (fixed length: 2)
  outputBlindings: [Field, Field], // Output blindings (fixed length: 2)
  publicAmount: Field, // Public amount
}) {}

// Define the JoinSplitTransaction ZkProgram
export const JoinSplitTransactionZkProgram = ZkProgram({
  name: "JoinSplitTransaction",

  publicOutput: TransactionPublicOutput, // Output includes nullifiers, commitments, and Merkle root

  methods: {
    proveTransaction: {
      privateInputs: [TransactionPrivateInput],
      method: async (
        transactionInput: TransactionPrivateInput
      ): Promise<TransactionPublicOutput> => {
        const nullifiers: TupleN<Field, 2> = TupleN.fromArray(
          2,
          [Field(0), Field(0)]
        ); // Initialize nullifiers
        const commitments: TupleN<Field, 2> = TupleN.fromArray(
          2,
          [Field(0), Field(0)]
        ); // Initialize commitments
        let inputSum = Field(0);
        let outputSum = Field(0);

        // Process inputs to compute nullifiers
        for (let i = 0; i < transactionInput.privateKeys.length; i++) {
          const privateKey = transactionInput.privateKeys[i];
          const amount = transactionInput.inputAmounts[i];
          const blinding = transactionInput.blindings[i];
          const merkleProof = transactionInput.merkleProofInputs[i];
          const merkleIndex = transactionInput.merkleProofIndex[i];

          // Derive public key from the private key
          const publicKey = privateKey.toPublicKey().toFields()[0];

          // Compute commitment: hash(amount, blinding, publicKey)
          const commitment = Poseidon.hash([amount, blinding, publicKey]);

          // Verify Merkle proof
          const [computedRoot, computedKey] = merkleProof.computeRootAndKeyV2(
            commitment
          );
          computedKey.assertEquals(commitment);

          // Compute nullifier: hash(commitment, index, privateKey)
          const nullifier = Poseidon.hash([
            commitment,
            merkleIndex,
            privateKey.toFields()[0],
          ]);
          nullifiers[i] = nullifier;

          // Accumulate input amounts
          inputSum = inputSum.add(amount);
        }

        // Process outputs to compute commitments
        for (let i = 0; i < transactionInput.outputAmounts.length; i++) {
          const amount = transactionInput.outputAmounts[i];
          const publicKey = transactionInput.outputPublicKeys[i];
          const blinding = transactionInput.outputBlindings[i];

          // Compute commitment: hash(amount, publicKey, blinding)
          const commitment = Poseidon.hash([amount, publicKey, blinding]);
          commitments[i] = commitment;

          // Accumulate output amounts
          outputSum = outputSum.add(amount);
        }

        // Verify input-output balance: sum of inputs + publicAmount == sum of outputs
        inputSum.add(transactionInput.publicAmount).assertEquals(outputSum);

        // Return the transaction's public output
        return new TransactionPublicOutput({
          nullifiers,
          commitments,
          publicAmount: transactionInput.publicAmount,
          root: transactionInput.merkleProofInputs[0].computeRootAndKeyV2(
            commitments[0]
          )[0], // Use root from the first commitment as an example
        });
      },
    },
  },
});

// Generate the proof class for the ZkProgram
export class JoinSplitTransactionProof extends ZkProgram.Proof(JoinSplitTransactionZkProgram) {}
