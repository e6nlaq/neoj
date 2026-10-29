import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";

const app = new Elysia()
    .use(
        cors({
            origin: "https://atcoder.jp",
            methods: ["POST", "OPTIONS"],
            allowedHeaders: ["Content-Type"],
        }),
    )
    .post(
        "/id",
        ({ body }) => {
            console.log(body.cookie);
            setTimeout(() => {
                app.stop();
                console.log("Server stopped");
            }, 0);

            return { ok: true };
        },
        {
            body: t.Object({
                cookie: t.String(),
            }),
        },
    )
    .listen(3000);

console.log(`Listening on http://${app.server?.hostname}:${app.server?.port}`);
