import { AtCoderClient } from "./src/lib/service/atcoder";

const atcoder = new AtCoderClient();
console.log(await atcoder.login(process.env.REVEL_SESSION!));

console.log(
    await atcoder.getProblem(
        "https://atcoder.jp/contests/math-and-algorithm/tasks/math_and_algorithm_an",
    ),
);
