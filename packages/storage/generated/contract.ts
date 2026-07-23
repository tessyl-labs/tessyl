import type { VoydPackageAdapterContract } from "@voyd-lang/package-adapter";

export const contract = {
  "abiVersion": 1,
  "packageName": "@tessyl/storage",
  "interfaces": [
    {
      "interfaceId": "tessyl:storage/document@1",
      "fingerprint": "764846d7e4f47933"
    },
    {
      "interfaceId": "tessyl:storage/object@1",
      "fingerprint": "2442863df1925d09"
    },
    {
      "interfaceId": "tessyl:storage/search-index@1",
      "fingerprint": "f0798dfaa04c23be"
    },
    {
      "interfaceId": "tessyl:storage/search@1",
      "fingerprint": "67badf780ccb5c0c"
    }
  ],
  "functions": [
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "claim_outbox",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "lease_seconds",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "limit",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "now",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "table",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "worker_id",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "array",
                  "element": {
                    "kind": "record",
                    "fields": [
                      {
                        "name": "attempt",
                        "schema": {
                          "kind": "i32"
                        }
                      },
                      {
                        "name": "document",
                        "schema": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "created_at",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "key",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "namespace",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "table",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "updated_at",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "nodes",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "record",
                                        "fields": [
                                          {
                                            "name": "value",
                                            "schema": {
                                              "kind": "union",
                                              "variants": [
                                                {
                                                  "name": "Empty",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "BoolNode",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "bool"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "I32Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "i32"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "I64Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "i64"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "F32Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "f32"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "F64Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "f64"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "TextNode",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "string"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "ListNode",
                                                  "fields": [
                                                    {
                                                      "name": "items",
                                                      "schema": {
                                                        "kind": "array",
                                                        "element": {
                                                          "kind": "i32"
                                                        }
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "RecordNode",
                                                  "fields": [
                                                    {
                                                      "name": "fields",
                                                      "schema": {
                                                        "kind": "array",
                                                        "element": {
                                                          "kind": "record",
                                                          "fields": [
                                                            {
                                                              "name": "name",
                                                              "schema": {
                                                                "kind": "string"
                                                              }
                                                            },
                                                            {
                                                              "name": "node",
                                                              "schema": {
                                                                "kind": "i32"
                                                              }
                                                            }
                                                          ]
                                                        }
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "NamedNode",
                                                  "fields": [
                                                    {
                                                      "name": "fields",
                                                      "schema": {
                                                        "kind": "array",
                                                        "element": {
                                                          "kind": "record",
                                                          "fields": [
                                                            {
                                                              "name": "name",
                                                              "schema": {
                                                                "kind": "string"
                                                              }
                                                            },
                                                            {
                                                              "name": "node",
                                                              "schema": {
                                                                "kind": "i32"
                                                              }
                                                            }
                                                          ]
                                                        }
                                                      }
                                                    },
                                                    {
                                                      "name": "name",
                                                      "schema": {
                                                        "kind": "string"
                                                      }
                                                    }
                                                  ]
                                                }
                                              ]
                                            }
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "name": "root",
                                    "schema": {
                                      "kind": "i32"
                                    }
                                  }
                                ]
                              }
                            },
                            {
                              "name": "version",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      },
                      {
                        "name": "lease_token",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "complete_outbox",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "lease_token",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "table",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": []
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "delete",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "condition",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "Any",
                    "fields": []
                  },
                  {
                    "name": "Absent",
                    "fields": []
                  },
                  {
                    "name": "Present",
                    "fields": []
                  },
                  {
                    "name": "Version",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "idempotency_key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "table",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": []
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "get",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "string"
        },
        {
          "kind": "string"
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "union",
                  "variants": [
                    {
                      "name": "None",
                      "fields": []
                    },
                    {
                      "name": "Some",
                      "fields": [
                        {
                          "name": "value",
                          "schema": {
                            "kind": "record",
                            "fields": [
                              {
                                "name": "created_at",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "key",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "namespace",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "table",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "updated_at",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "nodes",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "record",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "union",
                                                "variants": [
                                                  {
                                                    "name": "Empty",
                                                    "fields": []
                                                  },
                                                  {
                                                    "name": "BoolNode",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "bool"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "I32Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "i32"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "I64Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "i64"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "F32Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "f32"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "F64Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "f64"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "TextNode",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "string"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "ListNode",
                                                    "fields": [
                                                      {
                                                        "name": "items",
                                                        "schema": {
                                                          "kind": "array",
                                                          "element": {
                                                            "kind": "i32"
                                                          }
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "RecordNode",
                                                    "fields": [
                                                      {
                                                        "name": "fields",
                                                        "schema": {
                                                          "kind": "array",
                                                          "element": {
                                                            "kind": "record",
                                                            "fields": [
                                                              {
                                                                "name": "name",
                                                                "schema": {
                                                                  "kind": "string"
                                                                }
                                                              },
                                                              {
                                                                "name": "node",
                                                                "schema": {
                                                                  "kind": "i32"
                                                                }
                                                              }
                                                            ]
                                                          }
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "NamedNode",
                                                    "fields": [
                                                      {
                                                        "name": "fields",
                                                        "schema": {
                                                          "kind": "array",
                                                          "element": {
                                                            "kind": "record",
                                                            "fields": [
                                                              {
                                                                "name": "name",
                                                                "schema": {
                                                                  "kind": "string"
                                                                }
                                                              },
                                                              {
                                                                "name": "node",
                                                                "schema": {
                                                                  "kind": "i32"
                                                                }
                                                              }
                                                            ]
                                                          }
                                                        }
                                                      },
                                                      {
                                                        "name": "name",
                                                        "schema": {
                                                          "kind": "string"
                                                        }
                                                      }
                                                    ]
                                                  }
                                                ]
                                              }
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "name": "root",
                                      "schema": {
                                        "kind": "i32"
                                      }
                                    }
                                  ]
                                }
                              },
                              {
                                "name": "version",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "inspect_table",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "string"
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "definition",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "indexes",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "fields",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "record",
                                        "fields": [
                                          {
                                            "name": "path",
                                            "schema": {
                                              "kind": "string"
                                            }
                                          },
                                          {
                                            "name": "value_type",
                                            "schema": {
                                              "kind": "union",
                                              "variants": [
                                                {
                                                  "name": "Null",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "Boolean",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "Number",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "Text",
                                                  "fields": []
                                                }
                                              ]
                                            }
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "name": "name",
                                    "schema": {
                                      "kind": "string"
                                    }
                                  },
                                  {
                                    "name": "ordered",
                                    "schema": {
                                      "kind": "bool"
                                    }
                                  },
                                  {
                                    "name": "sparse",
                                    "schema": {
                                      "kind": "bool"
                                    }
                                  },
                                  {
                                    "name": "unique",
                                    "schema": {
                                      "kind": "bool"
                                    }
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "name": "name",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "schema_version",
                            "schema": {
                              "kind": "i32"
                            }
                          }
                        ]
                      }
                    },
                    {
                      "name": "definition_hash",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "document_count",
                      "schema": {
                        "kind": "i64"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "migrate_table",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "indexes",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "fields",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "path",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value_type",
                              "schema": {
                                "kind": "union",
                                "variants": [
                                  {
                                    "name": "Null",
                                    "fields": []
                                  },
                                  {
                                    "name": "Boolean",
                                    "fields": []
                                  },
                                  {
                                    "name": "Number",
                                    "fields": []
                                  },
                                  {
                                    "name": "Text",
                                    "fields": []
                                  }
                                ]
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "ordered",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "sparse",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "unique",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "name",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "schema_version",
              "schema": {
                "kind": "i32"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "definition",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "indexes",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "fields",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "record",
                                        "fields": [
                                          {
                                            "name": "path",
                                            "schema": {
                                              "kind": "string"
                                            }
                                          },
                                          {
                                            "name": "value_type",
                                            "schema": {
                                              "kind": "union",
                                              "variants": [
                                                {
                                                  "name": "Null",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "Boolean",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "Number",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "Text",
                                                  "fields": []
                                                }
                                              ]
                                            }
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "name": "name",
                                    "schema": {
                                      "kind": "string"
                                    }
                                  },
                                  {
                                    "name": "ordered",
                                    "schema": {
                                      "kind": "bool"
                                    }
                                  },
                                  {
                                    "name": "sparse",
                                    "schema": {
                                      "kind": "bool"
                                    }
                                  },
                                  {
                                    "name": "unique",
                                    "schema": {
                                      "kind": "bool"
                                    }
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "name": "name",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "schema_version",
                            "schema": {
                              "kind": "i32"
                            }
                          }
                        ]
                      }
                    },
                    {
                      "name": "definition_hash",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "document_count",
                      "schema": {
                        "kind": "i64"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "put",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "condition",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "Any",
                    "fields": []
                  },
                  {
                    "name": "Absent",
                    "fields": []
                  },
                  {
                    "name": "Present",
                    "fields": []
                  },
                  {
                    "name": "Version",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "idempotency_key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "table",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "value",
              "schema": {
                "kind": "record",
                "fields": [
                  {
                    "name": "nodes",
                    "schema": {
                      "kind": "array",
                      "element": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "value",
                            "schema": {
                              "kind": "union",
                              "variants": [
                                {
                                  "name": "Empty",
                                  "fields": []
                                },
                                {
                                  "name": "BoolNode",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "bool"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "I32Node",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "i32"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "I64Node",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "i64"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "F32Node",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "f32"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "F64Node",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "f64"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "TextNode",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "ListNode",
                                  "fields": [
                                    {
                                      "name": "items",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "i32"
                                        }
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "RecordNode",
                                  "fields": [
                                    {
                                      "name": "fields",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "record",
                                          "fields": [
                                            {
                                              "name": "name",
                                              "schema": {
                                                "kind": "string"
                                              }
                                            },
                                            {
                                              "name": "node",
                                              "schema": {
                                                "kind": "i32"
                                              }
                                            }
                                          ]
                                        }
                                      }
                                    }
                                  ]
                                },
                                {
                                  "name": "NamedNode",
                                  "fields": [
                                    {
                                      "name": "fields",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "record",
                                          "fields": [
                                            {
                                              "name": "name",
                                              "schema": {
                                                "kind": "string"
                                              }
                                            },
                                            {
                                              "name": "node",
                                              "schema": {
                                                "kind": "i32"
                                              }
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "name": "name",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    }
                                  ]
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  },
                  {
                    "name": "root",
                    "schema": {
                      "kind": "i32"
                    }
                  }
                ]
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "created_at",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "key",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "namespace",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "table",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "updated_at",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "value",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "nodes",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "value",
                                    "schema": {
                                      "kind": "union",
                                      "variants": [
                                        {
                                          "name": "Empty",
                                          "fields": []
                                        },
                                        {
                                          "name": "BoolNode",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "bool"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "I32Node",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "i32"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "I64Node",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "i64"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "F32Node",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "f32"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "F64Node",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "f64"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "TextNode",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "string"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "ListNode",
                                          "fields": [
                                            {
                                              "name": "items",
                                              "schema": {
                                                "kind": "array",
                                                "element": {
                                                  "kind": "i32"
                                                }
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "RecordNode",
                                          "fields": [
                                            {
                                              "name": "fields",
                                              "schema": {
                                                "kind": "array",
                                                "element": {
                                                  "kind": "record",
                                                  "fields": [
                                                    {
                                                      "name": "name",
                                                      "schema": {
                                                        "kind": "string"
                                                      }
                                                    },
                                                    {
                                                      "name": "node",
                                                      "schema": {
                                                        "kind": "i32"
                                                      }
                                                    }
                                                  ]
                                                }
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "name": "NamedNode",
                                          "fields": [
                                            {
                                              "name": "fields",
                                              "schema": {
                                                "kind": "array",
                                                "element": {
                                                  "kind": "record",
                                                  "fields": [
                                                    {
                                                      "name": "name",
                                                      "schema": {
                                                        "kind": "string"
                                                      }
                                                    },
                                                    {
                                                      "name": "node",
                                                      "schema": {
                                                        "kind": "i32"
                                                      }
                                                    }
                                                  ]
                                                }
                                              }
                                            },
                                            {
                                              "name": "name",
                                              "schema": {
                                                "kind": "string"
                                              }
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "name": "root",
                            "schema": {
                              "kind": "i32"
                            }
                          }
                        ]
                      }
                    },
                    {
                      "name": "version",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "query_documents",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "cursor",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "None",
                    "fields": []
                  },
                  {
                    "name": "Some",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "index",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "limit",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "lower",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "None",
                    "fields": []
                  },
                  {
                    "name": "Some",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "inclusive",
                              "schema": {
                                "kind": "bool"
                              }
                            },
                            {
                              "name": "values",
                              "schema": {
                                "kind": "array",
                                "element": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "union",
                                        "variants": [
                                          {
                                            "name": "Null",
                                            "fields": []
                                          },
                                          {
                                            "name": "Boolean",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "bool"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "I32",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "i32"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "I64",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "i64"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "F32",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "f32"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "F64",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "f64"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "Text",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "string"
                                                }
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    }
                                  ]
                                }
                              }
                            }
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "order",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "Ascending",
                    "fields": []
                  },
                  {
                    "name": "Descending",
                    "fields": []
                  }
                ]
              }
            },
            {
              "name": "prefix",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "value",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "Null",
                            "fields": []
                          },
                          {
                            "name": "Boolean",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "bool"
                                }
                              }
                            ]
                          },
                          {
                            "name": "I32",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "i32"
                                }
                              }
                            ]
                          },
                          {
                            "name": "I64",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "i64"
                                }
                              }
                            ]
                          },
                          {
                            "name": "F32",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "f32"
                                }
                              }
                            ]
                          },
                          {
                            "name": "F64",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "f64"
                                }
                              }
                            ]
                          },
                          {
                            "name": "Text",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "table",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "upper",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "None",
                    "fields": []
                  },
                  {
                    "name": "Some",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "inclusive",
                              "schema": {
                                "kind": "bool"
                              }
                            },
                            {
                              "name": "values",
                              "schema": {
                                "kind": "array",
                                "element": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "union",
                                        "variants": [
                                          {
                                            "name": "Null",
                                            "fields": []
                                          },
                                          {
                                            "name": "Boolean",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "bool"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "I32",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "i32"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "I64",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "i64"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "F32",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "f32"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "F64",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "f64"
                                                }
                                              }
                                            ]
                                          },
                                          {
                                            "name": "Text",
                                            "fields": [
                                              {
                                                "name": "value",
                                                "schema": {
                                                  "kind": "string"
                                                }
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    }
                                  ]
                                }
                              }
                            }
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "cursor",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "None",
                            "fields": []
                          },
                          {
                            "name": "Some",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        ]
                      }
                    },
                    {
                      "name": "documents",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "created_at",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "key",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "namespace",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "table",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "updated_at",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "nodes",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "record",
                                        "fields": [
                                          {
                                            "name": "value",
                                            "schema": {
                                              "kind": "union",
                                              "variants": [
                                                {
                                                  "name": "Empty",
                                                  "fields": []
                                                },
                                                {
                                                  "name": "BoolNode",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "bool"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "I32Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "i32"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "I64Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "i64"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "F32Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "f32"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "F64Node",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "f64"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "TextNode",
                                                  "fields": [
                                                    {
                                                      "name": "value",
                                                      "schema": {
                                                        "kind": "string"
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "ListNode",
                                                  "fields": [
                                                    {
                                                      "name": "items",
                                                      "schema": {
                                                        "kind": "array",
                                                        "element": {
                                                          "kind": "i32"
                                                        }
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "RecordNode",
                                                  "fields": [
                                                    {
                                                      "name": "fields",
                                                      "schema": {
                                                        "kind": "array",
                                                        "element": {
                                                          "kind": "record",
                                                          "fields": [
                                                            {
                                                              "name": "name",
                                                              "schema": {
                                                                "kind": "string"
                                                              }
                                                            },
                                                            {
                                                              "name": "node",
                                                              "schema": {
                                                                "kind": "i32"
                                                              }
                                                            }
                                                          ]
                                                        }
                                                      }
                                                    }
                                                  ]
                                                },
                                                {
                                                  "name": "NamedNode",
                                                  "fields": [
                                                    {
                                                      "name": "fields",
                                                      "schema": {
                                                        "kind": "array",
                                                        "element": {
                                                          "kind": "record",
                                                          "fields": [
                                                            {
                                                              "name": "name",
                                                              "schema": {
                                                                "kind": "string"
                                                              }
                                                            },
                                                            {
                                                              "name": "node",
                                                              "schema": {
                                                                "kind": "i32"
                                                              }
                                                            }
                                                          ]
                                                        }
                                                      }
                                                    },
                                                    {
                                                      "name": "name",
                                                      "schema": {
                                                        "kind": "string"
                                                      }
                                                    }
                                                  ]
                                                }
                                              ]
                                            }
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "name": "root",
                                    "schema": {
                                      "kind": "i32"
                                    }
                                  }
                                ]
                              }
                            },
                            {
                              "name": "version",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "retry_outbox",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "available_at",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "error",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "lease_token",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "table",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": []
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/document@1",
      "functionName": "transact",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "idempotency_key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "mutations",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "value",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "Put",
                            "fields": [
                              {
                                "name": "condition",
                                "schema": {
                                  "kind": "union",
                                  "variants": [
                                    {
                                      "name": "Any",
                                      "fields": []
                                    },
                                    {
                                      "name": "Absent",
                                      "fields": []
                                    },
                                    {
                                      "name": "Present",
                                      "fields": []
                                    },
                                    {
                                      "name": "Version",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "string"
                                          }
                                        }
                                      ]
                                    }
                                  ]
                                }
                              },
                              {
                                "name": "key",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "table",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "nodes",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "record",
                                          "fields": [
                                            {
                                              "name": "value",
                                              "schema": {
                                                "kind": "union",
                                                "variants": [
                                                  {
                                                    "name": "Empty",
                                                    "fields": []
                                                  },
                                                  {
                                                    "name": "BoolNode",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "bool"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "I32Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "i32"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "I64Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "i64"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "F32Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "f32"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "F64Node",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "f64"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "TextNode",
                                                    "fields": [
                                                      {
                                                        "name": "value",
                                                        "schema": {
                                                          "kind": "string"
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "ListNode",
                                                    "fields": [
                                                      {
                                                        "name": "items",
                                                        "schema": {
                                                          "kind": "array",
                                                          "element": {
                                                            "kind": "i32"
                                                          }
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "RecordNode",
                                                    "fields": [
                                                      {
                                                        "name": "fields",
                                                        "schema": {
                                                          "kind": "array",
                                                          "element": {
                                                            "kind": "record",
                                                            "fields": [
                                                              {
                                                                "name": "name",
                                                                "schema": {
                                                                  "kind": "string"
                                                                }
                                                              },
                                                              {
                                                                "name": "node",
                                                                "schema": {
                                                                  "kind": "i32"
                                                                }
                                                              }
                                                            ]
                                                          }
                                                        }
                                                      }
                                                    ]
                                                  },
                                                  {
                                                    "name": "NamedNode",
                                                    "fields": [
                                                      {
                                                        "name": "fields",
                                                        "schema": {
                                                          "kind": "array",
                                                          "element": {
                                                            "kind": "record",
                                                            "fields": [
                                                              {
                                                                "name": "name",
                                                                "schema": {
                                                                  "kind": "string"
                                                                }
                                                              },
                                                              {
                                                                "name": "node",
                                                                "schema": {
                                                                  "kind": "i32"
                                                                }
                                                              }
                                                            ]
                                                          }
                                                        }
                                                      },
                                                      {
                                                        "name": "name",
                                                        "schema": {
                                                          "kind": "string"
                                                        }
                                                      }
                                                    ]
                                                  }
                                                ]
                                              }
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "name": "root",
                                      "schema": {
                                        "kind": "i32"
                                      }
                                    }
                                  ]
                                }
                              }
                            ]
                          },
                          {
                            "name": "Delete",
                            "fields": [
                              {
                                "name": "condition",
                                "schema": {
                                  "kind": "union",
                                  "variants": [
                                    {
                                      "name": "Any",
                                      "fields": []
                                    },
                                    {
                                      "name": "Absent",
                                      "fields": []
                                    },
                                    {
                                      "name": "Present",
                                      "fields": []
                                    },
                                    {
                                      "name": "Version",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "string"
                                          }
                                        }
                                      ]
                                    }
                                  ]
                                }
                              },
                              {
                                "name": "key",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "table",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "deletes",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "key",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "table",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "replayed",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "writes",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "key",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "table",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "version",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/object@1",
      "functionName": "cleanup_abandoned",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "before",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "limit",
              "schema": {
                "kind": "i32"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "i32"
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/object@1",
      "functionName": "complete_upload",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "parts",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "etag",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "part_number",
                      "schema": {
                        "kind": "i32"
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "session_id",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "byte_length",
                      "schema": {
                        "kind": "i64"
                      }
                    },
                    {
                      "name": "checksum_sha256",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "content_type",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "created_at",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "key",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "metadata",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "namespace",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "version",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/object@1",
      "functionName": "delete_object",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "expected_version",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "None",
                    "fields": []
                  },
                  {
                    "name": "Some",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": []
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/object@1",
      "functionName": "initiate_upload",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "byte_length",
              "schema": {
                "kind": "i64"
              }
            },
            {
              "name": "checksum_sha256",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "content_type",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "expires_in_seconds",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "idempotency_key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "metadata",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "value",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "part_count",
              "schema": {
                "kind": "i32"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "expires_at",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "key",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "namespace",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "parts",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "part_number",
                              "schema": {
                                "kind": "i32"
                              }
                            },
                            {
                              "name": "url",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "session_id",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "upload_handle",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/object@1",
      "functionName": "resolve_download",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "expires_in_seconds",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "key",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "expires_at",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "metadata",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "byte_length",
                            "schema": {
                              "kind": "i64"
                            }
                          },
                          {
                            "name": "checksum_sha256",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "content_type",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "created_at",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "key",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "metadata",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "name",
                                    "schema": {
                                      "kind": "string"
                                    }
                                  },
                                  {
                                    "name": "value",
                                    "schema": {
                                      "kind": "string"
                                    }
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "name": "namespace",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "version",
                            "schema": {
                              "kind": "string"
                            }
                          }
                        ]
                      }
                    },
                    {
                      "name": "url",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/object@1",
      "functionName": "stat",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "string"
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "union",
                  "variants": [
                    {
                      "name": "None",
                      "fields": []
                    },
                    {
                      "name": "Some",
                      "fields": [
                        {
                          "name": "value",
                          "schema": {
                            "kind": "record",
                            "fields": [
                              {
                                "name": "byte_length",
                                "schema": {
                                  "kind": "i64"
                                }
                              },
                              {
                                "name": "checksum_sha256",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "content_type",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "created_at",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "key",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "metadata",
                                "schema": {
                                  "kind": "array",
                                  "element": {
                                    "kind": "record",
                                    "fields": [
                                      {
                                        "name": "name",
                                        "schema": {
                                          "kind": "string"
                                        }
                                      },
                                      {
                                        "name": "value",
                                        "schema": {
                                          "kind": "string"
                                        }
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "name": "namespace",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "version",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "begin_rebuild",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "facet_fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "filter_fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "locales",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "name",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "version",
              "schema": {
                "kind": "i32"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "active",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "generation",
                      "schema": {
                        "kind": "i32"
                      }
                    },
                    {
                      "name": "logical_name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "namespace",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "physical_name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "schema",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "facet_fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "filter_fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "locales",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "name",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "version",
                            "schema": {
                              "kind": "i32"
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "create",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "facet_fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "filter_fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "locales",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "name",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "version",
              "schema": {
                "kind": "i32"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "active",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "generation",
                      "schema": {
                        "kind": "i32"
                      }
                    },
                    {
                      "name": "logical_name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "namespace",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "physical_name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "schema",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "facet_fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "filter_fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "locales",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "name",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "version",
                            "schema": {
                              "kind": "i32"
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "cutover",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "logical_name",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "physical_name",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "active",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "generation",
                      "schema": {
                        "kind": "i32"
                      }
                    },
                    {
                      "name": "logical_name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "namespace",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "physical_name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "schema",
                      "schema": {
                        "kind": "record",
                        "fields": [
                          {
                            "name": "facet_fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "filter_fields",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "locales",
                            "schema": {
                              "kind": "array",
                              "element": {
                                "kind": "string"
                              }
                            }
                          },
                          {
                            "name": "name",
                            "schema": {
                              "kind": "string"
                            }
                          },
                          {
                            "name": "version",
                            "schema": {
                              "kind": "i32"
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "delete_document",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "document_id",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "index",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "version",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "applied",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "current_version",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "delete_generation",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "string"
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": []
                }
              }
            ]
          },
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "inspect",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "string"
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "union",
                  "variants": [
                    {
                      "name": "None",
                      "fields": []
                    },
                    {
                      "name": "Some",
                      "fields": [
                        {
                          "name": "value",
                          "schema": {
                            "kind": "record",
                            "fields": [
                              {
                                "name": "active",
                                "schema": {
                                  "kind": "bool"
                                }
                              },
                              {
                                "name": "generation",
                                "schema": {
                                  "kind": "i32"
                                }
                              },
                              {
                                "name": "logical_name",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "namespace",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "physical_name",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "schema",
                                "schema": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "facet_fields",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "string"
                                        }
                                      }
                                    },
                                    {
                                      "name": "fields",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "string"
                                        }
                                      }
                                    },
                                    {
                                      "name": "filter_fields",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "string"
                                        }
                                      }
                                    },
                                    {
                                      "name": "locales",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "string"
                                        }
                                      }
                                    },
                                    {
                                      "name": "name",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    },
                                    {
                                      "name": "version",
                                      "schema": {
                                        "kind": "i32"
                                      }
                                    }
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "list_generations",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "cursor",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "None",
                    "fields": []
                  },
                  {
                    "name": "Some",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "limit",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "logical_name",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "cursor",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "None",
                            "fields": []
                          },
                          {
                            "name": "Some",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        ]
                      }
                    },
                    {
                      "name": "generations",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "active",
                              "schema": {
                                "kind": "bool"
                              }
                            },
                            {
                              "name": "generation",
                              "schema": {
                                "kind": "i32"
                              }
                            },
                            {
                              "name": "logical_name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "namespace",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "physical_name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "schema",
                              "schema": {
                                "kind": "record",
                                "fields": [
                                  {
                                    "name": "facet_fields",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "string"
                                      }
                                    }
                                  },
                                  {
                                    "name": "fields",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "string"
                                      }
                                    }
                                  },
                                  {
                                    "name": "filter_fields",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "string"
                                      }
                                    }
                                  },
                                  {
                                    "name": "locales",
                                    "schema": {
                                      "kind": "array",
                                      "element": {
                                        "kind": "string"
                                      }
                                    }
                                  },
                                  {
                                    "name": "name",
                                    "schema": {
                                      "kind": "string"
                                    }
                                  },
                                  {
                                    "name": "version",
                                    "schema": {
                                      "kind": "i32"
                                    }
                                  }
                                ]
                              }
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search-index@1",
      "functionName": "upsert",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "document_id",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "text",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "filters",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "name",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "value",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "Null",
                            "fields": []
                          },
                          {
                            "name": "Boolean",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "bool"
                                }
                              }
                            ]
                          },
                          {
                            "name": "I32",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "i32"
                                }
                              }
                            ]
                          },
                          {
                            "name": "I64",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "i64"
                                }
                              }
                            ]
                          },
                          {
                            "name": "F32",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "f32"
                                }
                              }
                            ]
                          },
                          {
                            "name": "F64",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "f64"
                                }
                              }
                            ]
                          },
                          {
                            "name": "Text",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "index",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "locale",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "tags",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "version",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "applied",
                      "schema": {
                        "kind": "bool"
                      }
                    },
                    {
                      "name": "current_version",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "async",
      "interfaceId": "tessyl:storage/search@1",
      "functionName": "search",
      "params": [
        {
          "kind": "string"
        },
        {
          "kind": "record",
          "fields": [
            {
              "name": "cursor",
              "schema": {
                "kind": "union",
                "variants": [
                  {
                    "name": "None",
                    "fields": []
                  },
                  {
                    "name": "Some",
                    "fields": [
                      {
                        "name": "value",
                        "schema": {
                          "kind": "string"
                        }
                      }
                    ]
                  }
                ]
              }
            },
            {
              "name": "facets",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "fields",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "boost",
                      "schema": {
                        "kind": "f64"
                      }
                    },
                    {
                      "name": "name",
                      "schema": {
                        "kind": "string"
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "filters",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "value",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "Equal",
                            "fields": [
                              {
                                "name": "name",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "union",
                                  "variants": [
                                    {
                                      "name": "Null",
                                      "fields": []
                                    },
                                    {
                                      "name": "Boolean",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "bool"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "I32",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "i32"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "I64",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "i64"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "F32",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "f32"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "F64",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "f64"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "Text",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "string"
                                          }
                                        }
                                      ]
                                    }
                                  ]
                                }
                              }
                            ]
                          },
                          {
                            "name": "NotEqual",
                            "fields": [
                              {
                                "name": "name",
                                "schema": {
                                  "kind": "string"
                                }
                              },
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "union",
                                  "variants": [
                                    {
                                      "name": "Null",
                                      "fields": []
                                    },
                                    {
                                      "name": "Boolean",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "bool"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "I32",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "i32"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "I64",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "i64"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "F32",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "f32"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "F64",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "f64"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "name": "Text",
                                      "fields": [
                                        {
                                          "name": "value",
                                          "schema": {
                                            "kind": "string"
                                          }
                                        }
                                      ]
                                    }
                                  ]
                                }
                              }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            {
              "name": "index",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "limit",
              "schema": {
                "kind": "i32"
              }
            },
            {
              "name": "locale",
              "schema": {
                "kind": "string"
              }
            },
            {
              "name": "tags",
              "schema": {
                "kind": "array",
                "element": {
                  "kind": "string"
                }
              }
            },
            {
              "name": "text",
              "schema": {
                "kind": "string"
              }
            }
          ]
        }
      ],
      "result": {
        "kind": "union",
        "variants": [
          {
            "name": "Err",
            "fields": [
              {
                "name": "error",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "code",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "NotFound",
                            "fields": []
                          },
                          {
                            "name": "Conflict",
                            "fields": []
                          },
                          {
                            "name": "FailedCondition",
                            "fields": []
                          },
                          {
                            "name": "InvalidRequest",
                            "fields": []
                          },
                          {
                            "name": "InvalidData",
                            "fields": []
                          },
                          {
                            "name": "Unavailable",
                            "fields": []
                          },
                          {
                            "name": "QuotaExceeded",
                            "fields": []
                          },
                          {
                            "name": "LimitExceeded",
                            "fields": []
                          },
                          {
                            "name": "Timeout",
                            "fields": []
                          },
                          {
                            "name": "Cancelled",
                            "fields": []
                          },
                          {
                            "name": "Internal",
                            "fields": []
                          }
                        ]
                      }
                    },
                    {
                      "name": "details",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "value",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "message",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "operation",
                      "schema": {
                        "kind": "string"
                      }
                    },
                    {
                      "name": "retryable",
                      "schema": {
                        "kind": "bool"
                      }
                    }
                  ]
                }
              }
            ]
          },
          {
            "name": "Ok",
            "fields": [
              {
                "name": "value",
                "schema": {
                  "kind": "record",
                  "fields": [
                    {
                      "name": "cursor",
                      "schema": {
                        "kind": "union",
                        "variants": [
                          {
                            "name": "None",
                            "fields": []
                          },
                          {
                            "name": "Some",
                            "fields": [
                              {
                                "name": "value",
                                "schema": {
                                  "kind": "string"
                                }
                              }
                            ]
                          }
                        ]
                      }
                    },
                    {
                      "name": "facets",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "buckets",
                              "schema": {
                                "kind": "array",
                                "element": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "count",
                                      "schema": {
                                        "kind": "i64"
                                      }
                                    },
                                    {
                                      "name": "value",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    }
                                  ]
                                }
                              }
                            },
                            {
                              "name": "name",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    },
                    {
                      "name": "hits",
                      "schema": {
                        "kind": "array",
                        "element": {
                          "kind": "record",
                          "fields": [
                            {
                              "name": "document_id",
                              "schema": {
                                "kind": "string"
                              }
                            },
                            {
                              "name": "fields",
                              "schema": {
                                "kind": "array",
                                "element": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "name",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    },
                                    {
                                      "name": "text",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    }
                                  ]
                                }
                              }
                            },
                            {
                              "name": "highlights",
                              "schema": {
                                "kind": "array",
                                "element": {
                                  "kind": "record",
                                  "fields": [
                                    {
                                      "name": "field",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    },
                                    {
                                      "name": "ranges",
                                      "schema": {
                                        "kind": "array",
                                        "element": {
                                          "kind": "record",
                                          "fields": [
                                            {
                                              "name": "end",
                                              "schema": {
                                                "kind": "i32"
                                              }
                                            },
                                            {
                                              "name": "start",
                                              "schema": {
                                                "kind": "i32"
                                              }
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "name": "text",
                                      "schema": {
                                        "kind": "string"
                                      }
                                    }
                                  ]
                                }
                              }
                            },
                            {
                              "name": "score",
                              "schema": {
                                "kind": "f64"
                              }
                            },
                            {
                              "name": "version",
                              "schema": {
                                "kind": "string"
                              }
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    }
  ]
} as const satisfies VoydPackageAdapterContract;
