import { Field, PublicKey } from "o1js";

const randomInt = () => BigInt(Math.floor(Math.random() * 1000));
const pubkeyToField = (pk: PublicKey) => pk.toFields()[0];
export type SerializedNote = {
  pubkey: Field;
  blinding: Field;
  amount: Field;
};

export class Note {
  constructor(
    public pubkey: PublicKey,
    public amount: bigint,
    public blinding: bigint = randomInt(),
  ) { }

  serialize(): SerializedNote {
    return {
      pubkey: pubkeyToField(this.pubkey),
      blinding: Field(Number(this.blinding)),
      amount: Field(Number(this.amount)),
    };
  }
}

export type Store<T extends object | string | number | boolean> = {
  add(id: string, data: T): Promise<boolean>;
  get(id: string): Promise<T | undefined>;
  getAll(): Promise<T[]>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<boolean>;
};
