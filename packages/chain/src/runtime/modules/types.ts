import { Field, Poseidon, PrivateKey, PublicKey } from "o1js";
import { IndexedMerkleTree } from "./utils";
import { Block } from "@proto-kit/sequencer";

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

export class Wallet {
  constructor(
    private privateKey: PrivateKey,
    private notes: NoteWithMeta[] = [],
    private nullifiers: Field[] = [],
    private merkleTree: IndexedMerkleTree = new IndexedMerkleTree(8),
  ) { }

  static random() {
    return new Wallet(PrivateKey.random());
  }

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

  consumeBlock(block: Block, eventName: string) {
    const events = block?.transactions?.flatMap((tx) => tx.events) || [];
    console.log({ events });
    const matchingEvents = events.filter(
      (event) => event.eventName === eventName,
    );
    for (const event of matchingEvents) {
      const nullifierField = event.data[0];
      if (nullifierField instanceof Field) {
        console.log("adding nullifier");
        console.dir(nullifierField, { depth: null });
        this.nullifiers.push(nullifierField);
      } else {
        console.warn("Unexpected nullifier format:", event.data);
      }
    }
  }

  getPrivateKey() {
    return this.privateKey;
  }

  getPublicKey() {
    return this.privateKey.toPublicKey();
  }

  getBalance() {
    let unspent = this.getUnspentNotes();
    console.dir({ unspent }, { depth: null });
    let total = unspent.reduce((acc, note) => {
      acc += note.amount.toBigInt();
      return acc;
    }, 0n);

    return total;
  }

  addNote(index: bigint, note: Note | NoteWithMeta) {
    const nwm =
      note instanceof Note ? note.metaNote(this.privateKey, index) : note;
    this.notes.push(nwm);
  }

  addNullifer(nullifier: Field) {
    this.nullifiers.push(nullifier);
  }

  addNotesFromOutputs(outputs: Note[], merkleIndexes: bigint[]) {
    for (let i = 0; i < outputs.length; i++) {
      this.addNote(merkleIndexes[i], outputs[i]);
    }
  }

  getMerkleTree() {
    return this.merkleTree;
  }
}
