import { defineAdapter } from "../generated/voyd-adapter.js";
import { parse } from "../src/index.js";

export default defineAdapter({
  "tessyl:tfm/parser@1": {
    parse,
  },
});

export { parse };
