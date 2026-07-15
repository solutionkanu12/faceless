pragma circom 2.2.3;

include "circomlib/circuits/poseidon.circom";

// ============================================================
// FACELESS return proof
//
// Claim proven: "I hold a 5-token basket (amounts + tokens hidden).
// Each token's entry price and exit price are real prices that
// existed in that day's SoSoValue price sheet, attested by a
// single signed Merkle root per day (signature checked OUTSIDE
// this circuit, in Solidity, once per root). The resulting
// percentage return equals the publicly claimed value."
//
// Nothing about which tokens, amounts, or individual prices is
// revealed. Only the two daily roots and the claimed return are
// public.
// ============================================================

// One step of a Merkle path: hash current node with sibling,
// using pathBit to decide left/right order. pathBit must be 0/1.
template MerkleStep() {
    signal input node;
    signal input sibling;
    signal input pathBit;

    signal left;
    signal right;

    // pathBit === 0  -> node is left,  sibling is right
    // pathBit === 1  -> sibling is left, node is right
    left  <== node + pathBit * (sibling - node);
    right <== sibling + pathBit * (node - sibling);

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;

    signal output out;
    out <== h.out;
}

// Proves `leaf` is included under `root` given a path of fixed depth.
template MerkleInclusion(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathBits[depth];

    component steps[depth];
    signal cur[depth + 1];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // enforce pathBits[i] is boolean
        pathBits[i] * (1 - pathBits[i]) === 0;

        steps[i] = MerkleStep();
        steps[i].node <== cur[i];
        steps[i].sibling <== pathElements[i];
        steps[i].pathBit <== pathBits[i];
        cur[i + 1] <== steps[i].out;
    }

    cur[depth] === root;
}

// One basket leg: proves entry price and exit price for a hidden
// token are both real, attested prices, without revealing which
// token, its id, or the prices themselves.
template BasketLeg(depth) {
    signal input amount;          // private, hidden position size
    signal input currencyId;      // private, hidden which token
    signal input entryPrice;      // private
    signal input entryTimestamp;  // private, which day, hidden
    signal input entryPathElements[depth];
    signal input entryPathBits[depth];

    signal input exitPrice;       // private
    signal input exitTimestamp;   // private
    signal input exitPathElements[depth];
    signal input exitPathBits[depth];

    signal input entryRoot;       // public, signed by oracle
    signal input exitRoot;        // public, signed by oracle

    // leaf = Poseidon(currencyId, price, timestamp)
    component entryLeafHash = Poseidon(3);
    entryLeafHash.inputs[0] <== currencyId;
    entryLeafHash.inputs[1] <== entryPrice;
    entryLeafHash.inputs[2] <== entryTimestamp;

    component exitLeafHash = Poseidon(3);
    exitLeafHash.inputs[0] <== currencyId;
    exitLeafHash.inputs[1] <== exitPrice;
    exitLeafHash.inputs[2] <== exitTimestamp;

    component entryProof = MerkleInclusion(depth);
    entryProof.leaf <== entryLeafHash.out;
    entryProof.root <== entryRoot;
    for (var i = 0; i < depth; i++) {
        entryProof.pathElements[i] <== entryPathElements[i];
        entryProof.pathBits[i] <== entryPathBits[i];
    }

    component exitProof = MerkleInclusion(depth);
    exitProof.leaf <== exitLeafHash.out;
    exitProof.root <== exitRoot;
    for (var i = 0; i < depth; i++) {
        exitProof.pathElements[i] <== exitPathElements[i];
        exitProof.pathBits[i] <== exitPathBits[i];
    }

    signal output entryContribution;
    signal output exitContribution;
    entryContribution <== amount * entryPrice;
    exitContribution  <== amount * exitPrice;
}

// Main circuit: fixed 5-token basket.
template FacelessReturn(depth) {
    // ---- public inputs ----
    signal input entryRoot;
    signal input exitRoot;
    signal input claimedReturnBP;   // magnitude, basis points, e.g. 4120 = 41.20%
    signal input isNegative;        // 0 or 1

    // ---- private inputs, arrays of 5 ----
    signal input amount[5];
    signal input currencyId[5];
    signal input entryPrice[5];
    signal input entryTimestamp[5];
    signal input entryPathElements[5][depth];
    signal input entryPathBits[5][depth];
    signal input exitPrice[5];
    signal input exitTimestamp[5];
    signal input exitPathElements[5][depth];
    signal input exitPathBits[5][depth];

    component legs[5];
    signal entryVal[5];
    signal exitVal[5];

    for (var i = 0; i < 5; i++) {
        legs[i] = BasketLeg(depth);
        legs[i].amount <== amount[i];
        legs[i].currencyId <== currencyId[i];
        legs[i].entryPrice <== entryPrice[i];
        legs[i].entryTimestamp <== entryTimestamp[i];
        legs[i].exitPrice <== exitPrice[i];
        legs[i].exitTimestamp <== exitTimestamp[i];
        legs[i].entryRoot <== entryRoot;
        legs[i].exitRoot <== exitRoot;
        for (var j = 0; j < depth; j++) {
            legs[i].entryPathElements[j] <== entryPathElements[i][j];
            legs[i].entryPathBits[j] <== entryPathBits[i][j];
            legs[i].exitPathElements[j] <== exitPathElements[i][j];
            legs[i].exitPathBits[j] <== exitPathBits[i][j];
        }
        entryVal[i] <== legs[i].entryContribution;
        exitVal[i] <== legs[i].exitContribution;
    }

    signal entryTotal;
    signal exitTotal;
    entryTotal <== entryVal[0] + entryVal[1] + entryVal[2] + entryVal[3] + entryVal[4];
    exitTotal  <== exitVal[0]  + exitVal[1]  + exitVal[2]  + exitVal[3]  + exitVal[4];

    // isNegative must be boolean
    isNegative * (1 - isNegative) === 0;

    // signedReturn = +claimedReturnBP or -claimedReturnBP
    signal signedReturn;
    signedReturn <== claimedReturnBP * (1 - 2 * isNegative);

    // core claim, no division:
    // exitTotal * 10000 == entryTotal * (10000 + signedReturn)
    exitTotal * 10000 === entryTotal * (10000 + signedReturn);
}

component main {public [entryRoot, exitRoot, claimedReturnBP, isNegative]} = FacelessReturn(8);
