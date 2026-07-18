const WORD_SETS = [
  [
    "amber", "apricot", "azure", "beige", "bronze", "cerulean", "cobalt", "copper",
    "coral", "cream", "crimson", "denim", "emerald", "flaxen", "golden", "gray",
    "green", "indigo", "ivory", "jade", "lavender", "lilac", "linen", "magenta",
    "marble", "mint", "ochre", "olive", "opal", "peach", "pearl", "plum",
    "quartz", "rose", "ruby", "saffron", "scarlet", "silver", "slate", "teal",
    "topaz", "umber", "velvet", "violet", "walnut", "wheat", "white", "yellow",
  ],
  [
    "acacia", "alder", "aloe", "apple", "aspen", "bamboo", "birch", "blossom",
    "cedar", "clover", "cypress", "dahlia", "daisy", "elm", "fern", "fig",
    "fir", "flora", "garden", "ginger", "hazel", "heather", "herb", "holly",
    "iris", "ivy", "juniper", "laurel", "lemon", "lilac", "lotus", "maple",
    "meadow", "moss", "myrtle", "oak", "orchid", "palm", "pine", "poppy",
    "reed", "sage", "spruce", "thyme", "tulip", "willow", "yarrow", "yucca",
  ],
  [
    "arc", "aster", "aurora", "axis", "circle", "comet", "cosmos", "crescent",
    "cube", "dawn", "delta", "eclipse", "equinox", "galaxy", "globe", "halo",
    "helix", "horizon", "lattice", "lunar", "meteor", "nebula", "nova", "orbit",
    "oval", "prism", "pyramid", "quasar", "ray", "ring", "solar", "sphere",
    "spiral", "star", "summit", "sunrise", "sunset", "terra", "trine", "vertex",
    "vortex", "wave", "wedge", "zenith", "angle", "facet", "hexagon", "vector",
  ],
  [
    "anchor", "arch", "basket", "beacon", "bell", "bridge", "cabin", "canvas",
    "chime", "compass", "cove", "cradle", "drum", "feather", "flute", "harbor",
    "haven", "key", "kite", "lantern", "loom", "lyre", "map", "mirror",
    "mosaic", "needle", "paddle", "page", "path", "pebble", "quill", "ribbon",
    "sail", "shell", "shield", "shore", "spindle", "stone", "studio", "table",
    "tile", "tower", "trail", "vessel", "wheel", "window", "wing", "workshop",
  ],
] as const;

const WORD_MODIFIERS = [
  "", "bright", "calm", "clear", "cool", "crisp", "deep", "fair", "fresh", "gentle", "grand",
  "light", "little", "mellow", "misty", "neat", "new", "open", "pale", "quiet", "radiant",
  "round", "serene", "sharp", "soft", "steady", "still", "sunny", "swift", "warm", "wide", "wild",
  "young",
] as const;

const UUID_BYTE_LENGTH = 16;
const MAX_WORD_COUNT = WORD_SETS.length;

/** Number of possible default four-word IDs (currently more than six trillion). */
export const DEFAULT_WORD_ID_CAPACITY = WORD_SETS.reduce(
  (capacity, words) => capacity * BigInt(words.length * WORD_MODIFIERS.length),
  1n,
);

export type WordIdOptions = Readonly<{
  wordCount?: number;
}>;

/** Generates a UUIDv7 using the current Unix timestamp and cryptographic randomness. */
export const id = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTE_LENGTH));
  const timestamp = Date.now();

  for (let index = 5, value = timestamp; index >= 0; index -= 1) {
    bytes[index] = value % 256;
    value = Math.floor(value / 256);
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

/** Generates a dash-separated ID from curated word categories. */
export const wordId = ({ wordCount = MAX_WORD_COUNT }: WordIdOptions = {}): string => {
  if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount > MAX_WORD_COUNT) {
    throw new RangeError(`wordCount must be an integer from 1 through ${MAX_WORD_COUNT}`);
  }

  return WORD_SETS
    .slice(0, wordCount)
    .map((words) => {
      const modifier = WORD_MODIFIERS[randomIndex(WORD_MODIFIERS.length)]!;
      return `${modifier}${words[randomIndex(words.length)]!}`;
    })
    .join("-");
};

const randomIndex = (length: number): number => {
  const values = new Uint8Array(1);
  const unbiasedLimit = Math.floor(256 / length) * length;
  do {
    crypto.getRandomValues(values);
  } while (values[0]! >= unbiasedLimit);
  return values[0]! % length;
};
