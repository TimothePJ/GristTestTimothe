import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCoalescer } from "../assets/js/services/refreshCoalescer.js";

const FLAGS = ["notify", "clearInvalid", "forceRefresh"];

function setup() {
  const calls = [];
  const gates = [];
  const run = (options) => new Promise((resolve, reject) => {
    calls.push(options);
    gates.push({ resolve: () => resolve(options), reject });
  });
  return { calls, gates, request: createRefreshCoalescer(run, FLAGS) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const weak = { notify: false, clearInvalid: false, forceRefresh: false };

test("une demande identique ou plus faible réutilise la promesse en cours", async () => {
  const { calls, gates, request } = setup();
  const a = request({ ...weak, notify: true });
  const b = request({ ...weak, notify: true });
  const c = request(weak);
  assert.equal(a, b);
  assert.equal(a, c);
  await tick();
  assert.equal(calls.length, 1);
  gates[0].resolve();
  await a;
  assert.equal(calls.length, 1);
});

test("une demande forcée pendant un vol non forcé déclenche un seul rechargement forcé", async () => {
  const { calls, gates, request } = setup();
  const first = request(weak);
  await tick();
  const forced = request({ ...weak, forceRefresh: true });
  assert.notEqual(first, forced);
  gates[0].resolve();
  await first;
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].forceRefresh, true);
  gates[1].resolve();
  await forced;
});

test("deux demandes plus fortes pendant un même vol donnent un rechargement aux options fusionnées", async () => {
  const { calls, gates, request } = setup();
  const first = request(weak);
  await tick();
  const p1 = request({ ...weak, forceRefresh: true });
  const p2 = request({ ...weak, notify: true, clearInvalid: true });
  assert.equal(p1, p2);
  gates[0].resolve();
  await first;
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { notify: true, clearInvalid: true, forceRefresh: true });
  gates[1].resolve();
  await p1;
  assert.equal(calls.length, 2);
});

test("un vol forcé sans notification n'avale pas une demande avec notification", async () => {
  const { calls, gates, request } = setup();
  const first = request({ ...weak, forceRefresh: true });
  await tick();
  const second = request({ notify: true, clearInvalid: true, forceRefresh: false });
  gates[0].resolve();
  await first;
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].notify, true);
  gates[1].resolve();
  await second;
});

test("un échec de rechargement laisse passer la demande suivante", async () => {
  const { calls, gates, request } = setup();
  const first = request(weak);
  await tick();
  const forced = request({ ...weak, forceRefresh: true });
  gates[0].reject(new Error("boum"));
  await assert.rejects(first, /boum/);
  await tick();
  assert.equal(calls.length, 2);
  gates[1].resolve();
  await forced;
  const next = request(weak);
  await tick();
  assert.equal(calls.length, 3);
  gates[2].resolve();
  await next;
});
