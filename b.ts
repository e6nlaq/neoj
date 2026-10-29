import { AtCoderClient } from "./src/lib/service/atcoder";

const atcoder = new AtCoderClient();
console.log(await atcoder.login(process.env.REVEL_SESSION!));

console.log(await atcoder.getProblem("https://atcoder.jp/contests/arc233/tasks/arc233_a"));
