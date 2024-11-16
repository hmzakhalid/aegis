import { Field, MerkleTree } from "o1js";

class IndexedMerkleTree {
    public tree: MerkleTree;
    private currentIndex: bigint;

    constructor(height: number) {
        this.tree = new MerkleTree(height);
        this.currentIndex = 0n;
    }

    addLeaf(value: Field) {
        this.tree.setLeaf(this.currentIndex, value);
        this.currentIndex += 1n;
        return this.currentIndex - 1n;
    }

    getCurrentIndex(): bigint {
        return this.currentIndex - 1n;
    }

    getWitness(index: bigint) {
        return this.tree.getWitness(index);
    }

    getRoot() {
        return this.tree.getRoot();
    }
}

export { IndexedMerkleTree };

