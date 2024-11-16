import { Field, Poseidon, PrivateKey, PublicKey } from "o1js";
import { IndexedMerkleTree } from "./utils";

const randomInt = () => BigInt(Math.floor(Math.random() * 1000));
const pubkeyToField = (pk: PublicKey) => pk.toFields()[0];

export type NoteWithMeta = {
  pubkey: Field;
  blinding: Field;
  amount: Field;
  nullifier: Field;
  commitment: Field;
};

export class Note {
  constructor(
    public pubkey: Field,
    public amount: Field,
    public blinding: Field,
  ) { }

  static new(
    pubkey: PublicKey,
    amount: bigint,
    blinding: bigint = randomInt(),
  ) {
    console.log({ pubkey, amount, blinding });
    return new Note(
      pubkeyToField(pubkey),
      Field(Number(amount)),
      Field(Number(blinding)),
    );
  }

  static fromNoteWithMeta(note: NoteWithMeta) {
    return new Note(note.pubkey, note.amount, note.blinding);
  }

  commitment() {
    return Poseidon.hash([this.amount, this.blinding, this.pubkey]);
  }

  nullifier(privateKey: PrivateKey, index: bigint) {
    return Poseidon.hash([
      this.commitment(),
      Field(Number(index)),
      privateKey.toFields()[0],
    ]);
  }

  metaNote(privateKey: PrivateKey, index: bigint): NoteWithMeta {
    return {
      amount: this.amount,
      nullifier: this.nullifier(privateKey, index),
      commitment: this.commitment(),
      blinding: this.blinding,
      pubkey: this.pubkey,
    };
  }
}

export class NoteStore {
  constructor(
    private privateKey: PrivateKey,
    private notes: NoteWithMeta[] = [],
    private nullifiers: Field[] = [],
    private merkleTree: IndexedMerkleTree = new IndexedMerkleTree(8),
  ) { }

  getUnspentNotes() {
    return this.notes.filter((note) => {
      return !this.nullifiers
        .map((n) => n.toBigInt())
        .includes(note.nullifier.toBigInt());
    });
  }

  getNotesUpTo(amount: bigint): [Note[], bigint] {
    const notesOfAsset = this.getUnspentNotes();
    let total = 0n;
    let notes: Note[] = [];
    for (let note of notesOfAsset) {
      if (note.amount.toBigInt() === 0n) continue;
      total += note.amount.toBigInt();
      notes.push(Note.fromNoteWithMeta(note));
      if (total > amount) break;
    }
    return [notes, total];
  }

  getPrivateKey() {
    return this.privateKey;
  }

  getPublicKey() {
    return this.privateKey.toPublicKey();
  }

  addNote(index: bigint, note: Note | NoteWithMeta) {
    const nwm =
      note instanceof Note ? note.metaNote(this.privateKey, index) : note;
    this.notes.push(nwm);
  }

  getMerkleTree() {
    return this.merkleTree;
  }
}
