import { ZkProgram, Struct, PrivateKey, PublicKey, Field, Poseidon } from "o1js";

// Struct to define the public output of the proof
export class PublicOutput extends Struct({
  publicKey: PublicKey,
  commitment: Field,
}) {}

// Define the zk-SNARK program
export const PreimageZkProgram = ZkProgram({
  name: "PreimageVerification",

  publicOutput: PublicOutput, // The public key and commitment are the proof's outputs

  methods: {
    provePreimage: {
      privateInputs: [PrivateKey, Field, Field], // Private key, amount, blinding
      method: async (
        privateKey: PrivateKey,
        amount: Field,
        blinding: Field
      ): Promise<PublicOutput> => {
        // Compute the public key
        const publicKey = privateKey.toPublicKey();

        // Compute the commitment
        const commitment = Poseidon.hash([amount, blinding, publicKey.toFields()[0]]);

        return new PublicOutput({
          publicKey,
          commitment,
        });
      },
    },
  },
});

// Generate the proof class for the ZkProgram
export class PreimageProof extends ZkProgram.Proof(PreimageZkProgram) {}
