# CEL in the browser

The homepage demo classifies tool calls and proves translation units with Google's CEL, running
client-side. Nothing here is reimplemented: it is the browser build from
[kavishsathia/kavishsathia](https://github.com/kavishsathia/kavishsathia) at `f33109b`, where
`wasm-src/cel/` holds the build scripts and the facade's Java source.

| file | from | what it is |
| --- | --- | --- |
| `public/cel/cel-verifier-web.jar` | `public/cel/` | cel-java 0.14.0's `verifier` package, compiled from its sources unmodified, plus the `CelVerifierWeb` facade (Apache-2.0) |
| `public/cel/z3-cel.wasm`, `z3-cel.js` | `public/cel/` | Z3 4.14.1 (MIT), single-threaded Emscripten build |
| `engine.ts` | `src/lib/cel/engine.ts` | loads Z3, then CheerpJ 4.3 from its CDN, then the jar (trimmed to the calls used here) |
| `z3bridge.ts`, `z3natives.json` | `src/lib/cel/` | Z3's JNI surface implemented in JavaScript, generated from Z3's `def_API` declarations |

sha256, identical to the source repository's:

```
c74c722cc1d423689bafe52d8bf4281e7077694dd0828d30585ca6076079493e  cel-verifier-web.jar
eccc79baba0d0ca326fcee8acb89332aca26bb0ad16807c3d158df984b987f1f  z3-cel.wasm
f6907501b6bbb789c973f73d31396f89451ddca5a6aa5dd302d0382bb5a4abee  z3-cel.js
```

CheerpJ is loaded from Leaning Technologies' CDN, as its community license requires; check that
license covers how this site is used. Everything is fetched only when a visitor starts the demo.

`../demo/translation.ts` builds the same queries and reads the verifier's answers the way the
CLI's YAML translation units do (`cli/src/translate.rs`): the domain is `tool in [tools] &&
assumption`, rules must be pairwise disjoint, and with the generated fallback they must cover the
domain.
