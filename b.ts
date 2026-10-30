import { AtCoderClient } from "./src/lib/service/atcoder";

const atcoder = new AtCoderClient();
console.log(await atcoder.login(process.env.REVEL_SESSION!));

const data = await atcoder.getProblem("https://atcoder.jp/contests/awc0190/tasks/awc0190_a");
console.log(data);
console.log(data.startTime.toLocaleString());
