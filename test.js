"use strict";

const fs = require("fs");
const assert = require("assert");
const { runScript } = require("./interpreter");

const source = fs.readFileSync("EXAMPLE.txt", "utf8");

const result = runScript(source, { random: () => 0.5 });
const env = result.env;

const get = (name) => env.get(name);

assert.strictEqual(get("displayName"), "Ada Lovelace");
assert.strictEqual(get("doubled"), 42);
assert.strictEqual(get("calc1"), 7);
assert.strictEqual(get("calc2"), 9);
assert.strictEqual(get("joined2"), "one-two-three");
assert.strictEqual(get("joined3"), "one-two-three");
assert.strictEqual(get("fancy"), "onetwo");

assert.strictEqual(get("lenNumbers"), 5);
assert.strictEqual(get("lenName"), 3);
assert.strictEqual(get("lenUser"), 5);

assert.deepStrictEqual(result.output, [
  "Ada Lovelace",
  "DR",
  "DR",
  "DR",
]);

console.log("All tests passed.");
