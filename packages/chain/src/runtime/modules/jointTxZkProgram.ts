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
class MyMerkleWitness extends MerkleWitness(treeHeight) {}

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
  merkleWitnesses: [MyMerkleWitness, MyMerkleWitness], // Merkle witnesses for inputs (fixed length: 2)
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

          // Derive public key from the private key
          const publicKey = privateKey.toPublicKey().toFields()[0];

          // Compute commitment: hash(amount, blinding, publicKey)
          const commitment = Poseidon.hash([amount, blinding, publicKey]);

          // Get Index
          const witnessIndex = merkleWitness.calculateIndex();

          // Compute nullifier: hash(commitment, index, privateKey)
          const nullifier = Poseidon.hash([
            commitment,
            witnessIndex, // Use index as part of the nullifier
            privateKey.toFields()[0],
          ]);
          nullifiers.push(nullifier);

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
          commitments.push(commitment);

          // Accumulate output amounts
          outputSum = outputSum.add(amount);
        }

        // Verify input-output balance: sum of inputs + publicAmount == sum of outputs
        inputSum.add(transactionInput.publicAmount).assertEquals(outputSum);

        // Return the transaction's public output
        return new TransactionPublicOutput({
          nullifiers: [nullifiers[0], nullifiers[1]],
          commitments: [commitments[0], commitments[1]],
          publicAmount: transactionInput.publicAmount,
          root: transactionInput.merkleWitnesses[0].calculateRoot(commitments[0]),
        });
      },
    },
  },
});

// Generate the proof class for the ZkProgram
export class JoinSplitTransactionProof extends ZkProgram.Proof(JoinSplitTransactionZkProgram) {}
