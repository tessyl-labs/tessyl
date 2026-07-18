import type { VoydPackageAdapterContract } from "@voyd-lang/package-adapter";

export const contract = {
  "abiVersion": 1,
  "packageName": "@tessyl/id",
  "interfaces": [
    {
      "interfaceId": "tessyl:id/generator@1",
      "fingerprint": "76962eee37679d2a"
    }
  ],
  "functions": [
    {
      "kind": "async",
      "interfaceId": "tessyl:id/generator@1",
      "functionName": "id",
      "params": [],
      "result": {
        "kind": "string"
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:id/generator@1",
      "functionName": "word_id",
      "params": [
        {
          "kind": "i32"
        }
      ],
      "result": {
        "kind": "string"
      }
    }
  ]
} as const satisfies VoydPackageAdapterContract;
