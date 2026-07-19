import { defineVoydPackageAdapter } from "@voyd-lang/package-adapter";
import type { VoydPackageAdapterInvocationContext } from "@voyd-lang/package-adapter";
import { contract } from "./contract.js";

export type AdapterImplementation = {
  readonly "tessyl:tfm/parser@1": {
    readonly "parse": (this: VoydPackageAdapterInvocationContext, arg0: string) => { "diagnostics": readonly { "code": string; "message": string; "severity": string; "span": { "end": number; "endColumn": number; "endLine": number; "start": number; "startColumn": number; "startLine": number } }[]; "limits": { "maxAttributeCount": number; "maxAttributeLength": number; "maxDiagnostics": number; "maxNestingDepth": number; "maxNodeCount": number; "maxSourceBytes": number }; "nodes": readonly { "alignments": readonly string[]; "attributes": readonly { "booleanValue": boolean; "integerValue": number; "name": string; "type": string; "value": string }[]; "checked": boolean; "children": readonly number[]; "depth": number; "identifier": string; "kind": string; "language": string; "listStart": number; "ordered": boolean; "span": { "end": number; "endColumn": number; "endLine": number; "start": number; "startColumn": number; "startLine": number }; "task": boolean; "text": string; "title": string; "url": string }[]; "root": number; "schemaVersion": string; "success": boolean; "vocabularyVersion": string };
  };
  readonly "tessyl:tfm/renderer@1": {
    readonly "render_html": (this: VoydPackageAdapterInvocationContext, arg0: string) => { "contentSecurityPolicy": string; "diagnostics": readonly { "code": string; "message": string; "severity": string; "span": { "end": number; "endColumn": number; "endLine": number; "start": number; "startColumn": number; "startLine": number } }[]; "html": string; "schemaVersion": string; "success": boolean; "vocabularyVersion": string };
    readonly "render_html_with_resources": (this: VoydPackageAdapterInvocationContext, arg0: string, arg1: readonly { "cells": readonly string[]; "columns": readonly string[]; "id": string; "kind": string; "label": string; "url": string }[]) => { "contentSecurityPolicy": string; "diagnostics": readonly { "code": string; "message": string; "severity": string; "span": { "end": number; "endColumn": number; "endLine": number; "start": number; "startColumn": number; "startLine": number } }[]; "html": string; "schemaVersion": string; "success": boolean; "vocabularyVersion": string };
  };
};

export const defineAdapter = (implementation: AdapterImplementation) =>
  defineVoydPackageAdapter(contract, implementation);
