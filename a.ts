const res = await fetch("https://atcoder.jp/contests/abc001/tasks/abc001_1", {
    headers: { Cookie: `REVEL_SESSION=${process.env.REVEL_SESSION};` },
});

console.log(res);
console.log(await res.text());
