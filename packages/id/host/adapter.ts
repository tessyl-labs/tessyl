import { defineAdapter } from "../generated/voyd-adapter.js";
import { id, wordId } from "../src/index.js";

export default defineAdapter({
  "tessyl:id/generator@1": {
    id,
    word_id: (wordCount) => wordId({ wordCount }),
  },
});
