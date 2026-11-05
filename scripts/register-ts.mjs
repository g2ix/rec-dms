import { register } from "node:module";

await register("./resolve-ts.mjs", import.meta.url);
