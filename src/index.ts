import { writeText } from "tinyclip";

import { solve } from "./b";

console.log("Hello via Bun!");

if (typeof Bun !== "undefined") {
    console.log(await import("./a").then((m) => m.hello()));
    await writeText(solve(2).toString());
}
