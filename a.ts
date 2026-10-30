const res = await fetch("https://atcoder.jp/contests/awc0190/submissions/me", {
    headers: { Cookie: `REVEL_SESSION=${process.env.REVEL_SESSION};` },
});

console.log(res);
console.log(await res.text());
