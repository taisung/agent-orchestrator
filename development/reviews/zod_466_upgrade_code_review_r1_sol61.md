# Zod upgrade code review r1 — sol61

NOT-LAND-SAFE

Review of `d9794f3e..486ddb0d`, 2026-10-24. **4 blocking findings, 1 major finding, 1 minor finding.** The build, type, lint, normal test, red-defect comparison and secret-scanning gates pass. The absolute config compatibility requirement does not: a YAML config rejected by base is accepted by tip, and several public `validateConfig(unknown)` results change. The three live YAML config copies parse equally.

This is an independent review. No production code change, commit, branch replay, push, PR, real AO invocation, model turn, or external network call was made. Initial and final HEAD agree. Audit was **not run**, as required by the review brief. All pnpm, node and test calls used a cleared environment, scratch HOME/TMPDIR, cached pnpm 9.15.4 with HUSKY=0 and NPM_CONFIG_OFFLINE=true, a curated PATH without agent/herdr/npm/npx binaries, a gh stub limited to version/auth-status, and private tmux routing. Test fixture executables are synthetic, not real agents.

## Findings

### B-1 — Record parsing now accepts invalid values under `__proto__`, including YAML

**Location:** `packages/core/src/config.ts:298`; also `:241`, `:307`, `:308`, `:309`.

Zod 4's `$ZodRecord` skips an own `__proto__` key before running either the key or the value validator. Base validates the value, then safely omits that key when constructing the result. Thus the tip broadens acceptance; this is not merely a changed Zod error text.

Reproducer: save the following as a scratch YAML file and call each built core's `loadConfig(file)`:

```yaml
projects:
  __proto__: null
```

Base rejects it with `invalid_type` at `projects.__proto__`; tip accepts it and produces empty projects. The additional YAML harness tried invalid null, boolean, string and array values at all five record positions: 19 of 20 comparisons change rejection to acceptance. The unchanged case is a routing array, already valid for that record. This finding applies to file-loaded configs, independently of the JavaScript-only edge cases below.

Preserve the old value validation before safely discarding reserved keys, or obtain an explicit owner exception to the no-acceptance-change requirement. Do not restore unsafe prototype assignment.

### B-2 — Loose objects add formerly dropped unknown keys whose value is `undefined`

**Location:** `packages/core/src/config.ts:183`; also `.loose()` at `:134`, `:159`, `:168`, `:194`.

Reproducer:

```js
validateConfig({ projects: { app: {
  repo: "org/app", path: "/repos/app", agentConfig: { extra: undefined }
} } });
```

Base agentConfig has only the own key `permissions`; tip has `permissions, extra`. The value of `extra` remains undefined. Zod 3's passthrough merge omits an unknown undefined-valued key; Zod 4's loose object retains it. This affects tracker, SCM, notifier, project agentConfig and both role agentConfig locations. The harness found all six directly and repeated the difference in accepted random combinations. The contract explicitly requires preserving undefined and key presence, so JSON serialization would hide a blocking difference here.

Normalize unknown undefined-valued loose keys to the old result without dropping explicitly supplied **known** optional keys.

### B-3 — Records drop inherited keys and begin rejecting symbol keys

**Location:** `packages/core/src/config.ts:308`; the other four record positions have the same issue.

Reproducers:

```js
validateConfig({ projects: {},
  notificationRouting: Object.create({ urgent: ["desktop"] }) });
validateConfig({ projects: {},
  notificationRouting: { [Symbol.for("extra")]: ["desktop"] } });
```

Base copies the inherited `urgent` route; tip returns an empty routing object. Base ignores the symbol key; tip rejects it as `invalid_key`. Zod 3 enumerates records with `for..in`, whereas the non-enumerable-key-schema branch of Zod 4 uses enumerable `Reflect.ownKeys`. All five record positions reproduce both changes. These inputs exercise the public raw-object validator; the three real YAML copies do not contain them. No owner decision in the supplied briefs excludes such raw inputs.

### B-4 — Record containers now reject previously accepted class instances

**Location:** `packages/core/src/config.ts:308`; the other four record positions have the same issue.

Reproducer:

```js
class Routes { urgent = ["desktop"]; }
validateConfig({ projects: {}, notificationRouting: new Routes() });
```

Base accepts and returns the `urgent` route. Tip rejects the container with `invalid_type`, expected record. Zod 4 applies `util.isPlainObject`; Zod 3's record accepts this object classification. The harness reproduced this at every record position. As with B-3, this is a raw-object API compatibility failure, not a claim that ordinary YAML creates class instances. A compatibility normalization must match base's classification rather than indiscriminately accepting Date/Map/Set/array values.

### M-1 — The live landing also requires restarting resident AO processes

**Location:** `packages/core/package.json:52`; resident consumer `packages/cli/src/commands/lifecycle-worker.ts:23` and its existing-worker guard at `:38`.

The install/build sequence succeeds, but a running lifecycle worker retains the old imported config module and Zod 3 in memory. A resident scratch Node probe imported the base module, replaced the built files and dependency link with tip's, then imported the same URL again: it was the same module and still produced the Zod 3 issue code. A fresh process used the new code. Consequently the vulnerable dependency and old validator remain loaded in existing workers, watch commands, or other resident AO CLI processes until they exit/restart. Merely invoking start can keep an already-running worker through its guard.

Include an owner-controlled restart of resident AO processes in the landing procedure after install/build. No live worker was touched in this review. This is major under the brief's rule that a live upgrade needing more than install/build must be called out.

### m-1 — The new tests do not fully pin key presence or the rebuilt number bounds

**Location:** `packages/core/src/__tests__/config-zod-pins.test.ts:44`, `:87`, `:209`.

Three deliberately wrong fixes each build and pass all 33 tests in the two targeted files:

- Change agentConfig prefault to `{ model: undefined }`: absent agentConfig acquires an extra own model key. The `.toEqual` oracle ignores that undefined-valued key.
- Strip explicit undefined-valued fields from project reaction overrides: `{auto: undefined}` becomes `{}`. The tests cover absent fields, not explicit undefined.
- Remove the finite nonnegative constraint from the readyThresholdMs union: `-1` becomes accepted. The new test checks negative infinity but not a finite negative value.

Separate probes demonstrate each mutant's wrong behavior. Use strict key-presence/order assertions where they are part of the contract, and add a finite-negative threshold case. These are test-quality findings; the first two are distinct from fixing the production regressions above.

### Minimal reproduction receipts

Saved receipt: `/tmp/aozr/evidence/findings-receipts.txt` (embedded before scratch cleanup).

```json
{"name":"loose undefined key","base":{"ok":true,"keys":["permissions"],"extraIn":false},"tip":{"ok":true,"keys":["permissions","extra"],"extraIn":true}}
{"name":"record inherited key","base":{"ok":true,"keys":["urgent"]},"tip":{"ok":true,"keys":[]}}
{"name":"record symbol key","base":{"ok":true,"keys":[]},"tip":{"ok":false,"issues":[{"path":["notificationRouting","Symbol(extra)"],"code":"invalid_key","message":"Invalid key in record"}],"name":"ZodError"}}
{"name":"record class instance","base":{"ok":true,"keys":["urgent"]},"tip":{"ok":false,"issues":[{"path":["notificationRouting"],"code":"invalid_type","message":"Invalid input: expected record, received Routes"}],"name":"ZodError"}}
{
  "yamlProtoComparisons": 20,
  "mismatches": 19,
  "firstExample": {
    "name": "projects",
    "invalid": "null",
    "base": {
      "ok": false,
      "issues": [
        {
          "path": [
            "projects",
            "__proto__"
          ],
          "code": "invalid_type",
          "message": "Expected object, received null"
        }
      ]
    },
    "tip": {
      "ok": true
    }
  }
}
```

### Resident import cache receipt

Saved receipt: `/tmp/aozr/evidence/resident.log` (embedded before scratch cleanup).

```json
{"initialCode":"invalid_string","sameModuleAfterRebuild":true,"residentAfterRebuild":"invalid_string","newProcessAfterRebuild":"invalid_key"}
```

### Wrong fixes accepted by the tests: measured behavior

Saved receipt: `/tmp/aozr/evidence/wrong-probes.log` (embedded before scratch cleanup).

```text
{"name":"wrong-prefault-add-undefined","base":["permissions"],"mutant":["permissions","model"]}
{"name":"wrong-reaction-strip-undefined","base":["auto"],"mutant":[]}
{"name":"wrong-ready-negative","base":"rejected","mutant":"accepted"}
restore build=0
```

## Differential harness and scope

I wrote the harness independently; the implementer's harness was not reused. The main script was written after reading both config/feedback sources and their users. The implementer's report was read only after the independent source review; its reported counts are not substituted for this review's receipts.

The main canonical form is a recursively tagged tree. It distinguishes undefined, null, NaN, positive and negative infinity, and negative zero; keeps array length and enumerable own keys; retains object key order and symbol identity labels; and marks dates, bigint and functions. Input copying retains prototypes and property descriptors so the record-container probes are meaningful. Both success lists are nonempty and contain the known minimal accepted config; feedback includes a known valid payload for each tool. Errors are compared for accept/reject classification; exact error text/shape is audited separately.

Coverage includes every top-level field and schema field; missing versus explicitly undefined versus null; wrong types; empty strings/arrays/objects; all enum alternatives; numeric bounds, fractional and unsafe integers, infinities, NaN and -0; object-level unknown keys; default role and project role blocks; all agentConfig forms; global versus project reactions; decomposer; installed plugins; webhook fields; notifiers; routing; reserved, inherited and symbol record keys; class and null-prototype containers; seeded mixed invalid combinations; and combinations of mostly valid values. Array default cloning and existing caller behavior are also exercised by the committed tests.

Main result: 12,507 configs, 5,889 accepted by both and 6,608 rejected by both. There are 1,051 mismatches: 1,041 accepted-value differences and 10 acceptance differences. The mismatch groups are six direct unknown-key cases, five inherited-record cases, five class-record cases, five symbol-record cases and 1,030 repeated random loose-undefined cases. These are repetitions of B-2/B-3/B-4, not thousands of independent bugs. B-1 was found by an additional 20 file-loaded reserved-key cases.

Feedback input validation: 2,326 calls across both tools, 80 accepted and 2,246 rejected by both, zero differences. Persisted createdAt: 3,084 candidate strings, 529 accepted per side, zero differences. The createdAt regex **source itself** is also identical to the shipped Zod 3 `datetimeRegex({offset:true})`, not merely equal on the sampled strings. Persisted id/tool/dedupe/confidence metadata: 22 cases, eight accepted per side, zero differences. Ten additional synthetic YAML files give eight equal successes and two equal rejections, covering infinities, NaN, -0, nested defaults, permissions and reaction order.

The three live configs were copied read-only into the scratch configs directory and loaded explicitly through each build's `loadConfig`. Only the named copy is read by that code path; it does not read agentRulesFile, plugin paths or another relative config. HOME expansion uses the same scratch HOME on both sides. All comparisons are nonempty and include `defaults.agent`. Only key paths and equality are printed; no secret/token values are included.

### Main config comparison totals

Saved receipt: `/tmp/aozr/evidence/config-summary.json` (embedded before scratch cleanup).

```json
{
  "configCases": 12507,
  "bothAccepted": 5889,
  "bothRejected": 6608,
  "mismatches": 1051,
  "sentinel": {
    "id": "minimal",
    "base": true,
    "tip": true
  }
}
```

### Main differential receipts

From `/tmp/aozr/evidence/harness.log`, `/tmp/aozr/evidence/diff-summary.txt` and the scripts reproduced below.

```text
config mismatch groups {"record-class": 5, "record-inherited": 5, "record-symbol": 5, "unknown": 6, "valid-random": 1030}
accepted-value changes 1041
acceptance changes 10
base install exit=0 build exit=0 typecheck exit=0 lint exit=0
tip install exit=0 build exit=0 typecheck exit=0 lint exit=0
{"feedbackCases":2326,"bothAccepted":80,"bothRejected":2246,"mismatches":0,"sentinel":"feedback-valid accepted for both tools on both sides"}
{"createdAtCases":3084,"baseAccepted":529,"tipAccepted":529,"mismatches":0,"sentinel":"report_form_0 = 2024-02-29T12:34Z"}
{"liveConfig":"primary.yaml","baseKeys":56,"tipKeys":56,"sentinel":"defaults.agent","equal":true,"keyPaths":["port","readyThresholdMs","defaults.runtime","defaults.agent","defaults.workspace","projects.agent-orchestrator.name","projects.agent-orchestrator.repo","projects.agent-orchestrator.path","projects.agent-orchestrator.defaultBranch","projects.agent-orchestrator.sessionPrefix","projects.agent-orchestrator.agentConfig.permissions","projects.agent-orchestrator.agentRules","projects.agent-orchestrator.orchestratorWorkspaceMode","projects.agent-orchestrator.scm.plugin","projects.agent-orchestrator.tracker.plugin","reactions.ci-failed.auto","reactions.ci-failed.action","reactions.ci-failed.message","reactions.ci-failed.retries","reactions.ci-failed.escalateAfter","reactions.changes-requested.auto","reactions.changes-requested.action","reactions.changes-requested.message","reactions.changes-requested.escalateAfter","reactions.bugbot-comments.auto","reactions.bugbot-comments.action","reactions.bugbot-comments.message","reactions.bugbot-comments.escalateAfter","reactions.merge-conflicts.auto","reactions.merge-conflicts.action","reactions.merge-conflicts.message","reactions.merge-conflicts.escalateAfter","reactions.approved-and-green.auto","reactions.approved-and-green.action","reactions.approved-and-green.priority","reactions.approved-and-green.message","reactions.agent-idle.auto","reactions.agent-idle.action","reactions.agent-idle.message","reactions.agent-idle.retries","reactions.agent-idle.escalateAfter","reactions.agent-stuck.auto","reactions.agent-stuck.action","reactions.agent-stuck.priority","reactions.agent-stuck.threshold","reactions.agent-needs-input.auto","reactions.agent-needs-input.action","reactions.agent-needs-input.priority","reactions.agent-exited.auto","reactions.agent-exited.action","reactions.agent-exited.priority","reactions.all-complete.auto","reactions.all-complete.action","reactions.all-complete.priority","reactions.all-complete.includeSummary","configPath"]}
{"liveConfig":"skills.yaml","baseKeys":56,"tipKeys":56,"sentinel":"defaults.agent","equal":true,"keyPaths":["port","readyThresholdMs","defaults.runtime","defaults.agent","defaults.workspace","projects.agent-skills.name","projects.agent-skills.repo","projects.agent-skills.path","projects.agent-skills.defaultBranch","projects.agent-skills.sessionPrefix","projects.agent-skills.agentConfig.permissions","projects.agent-skills.agentRules","projects.agent-skills.orchestratorWorkspaceMode","projects.agent-skills.scm.plugin","projects.agent-skills.tracker.plugin","reactions.ci-failed.auto","reactions.ci-failed.action","reactions.ci-failed.message","reactions.ci-failed.retries","reactions.ci-failed.escalateAfter","reactions.changes-requested.auto","reactions.changes-requested.action","reactions.changes-requested.message","reactions.changes-requested.escalateAfter","reactions.bugbot-comments.auto","reactions.bugbot-comments.action","reactions.bugbot-comments.message","reactions.bugbot-comments.escalateAfter","reactions.merge-conflicts.auto","reactions.merge-conflicts.action","reactions.merge-conflicts.message","reactions.merge-conflicts.escalateAfter","reactions.approved-and-green.auto","reactions.approved-and-green.action","reactions.approved-and-green.priority","reactions.approved-and-green.message","reactions.agent-idle.auto","reactions.agent-idle.action","reactions.agent-idle.message","reactions.agent-idle.retries","reactions.agent-idle.escalateAfter","reactions.agent-stuck.auto","reactions.agent-stuck.action","reactions.agent-stuck.priority","reactions.agent-stuck.threshold","reactions.agent-needs-input.auto","reactions.agent-needs-input.action","reactions.agent-needs-input.priority","reactions.agent-exited.auto","reactions.agent-exited.action","reactions.agent-exited.priority","reactions.all-complete.auto","reactions.all-complete.action","reactions.all-complete.priority","reactions.all-complete.includeSummary","configPath"]}
{"liveConfig":"nexus.yaml","baseKeys":81,"tipKeys":81,"sentinel":"defaults.agent","equal":true,"keyPaths":["port","readyThresholdMs","defaults.runtime","defaults.agent","defaults.workspace","defaults.notifiers.0","projects.Nexus.name","projects.Nexus.repo","projects.Nexus.path","projects.Nexus.defaultBranch","projects.Nexus.sessionPrefix","projects.Nexus.agentConfig.permissions","projects.Nexus.orchestrator.agent","projects.Nexus.orchestrator.agentConfig.model","projects.Nexus.worker.agent","projects.Nexus.worker.agentConfig.model","projects.Nexus.agentRules","projects.Nexus.orchestratorWorkspaceMode","projects.Nexus.scm.plugin","projects.Nexus.tracker.plugin","projects.FleetMonitor.name","projects.FleetMonitor.repo","projects.FleetMonitor.path","projects.FleetMonitor.defaultBranch","projects.FleetMonitor.sessionPrefix","projects.FleetMonitor.agentConfig.permissions","projects.FleetMonitor.worker.agent","projects.FleetMonitor.worker.agentConfig.model","projects.FleetMonitor.agentRules","projects.FleetMonitor.scm.plugin","projects.FleetMonitor.tracker.plugin","projects.agent-orchestrator.name","projects.agent-orchestrator.repo","projects.agent-orchestrator.path","projects.agent-orchestrator.defaultBranch","projects.agent-orchestrator.sessionPrefix","projects.agent-orchestrator.agentConfig.permissions","projects.agent-orchestrator.agentRules","projects.agent-orchestrator.scm.plugin","projects.agent-orchestrator.tracker.plugin","reactions.ci-failed.auto","reactions.ci-failed.action","reactions.ci-failed.message","reactions.ci-failed.retries","reactions.ci-failed.escalateAfter","reactions.changes-requested.auto","reactions.changes-requested.action","reactions.changes-requested.message","reactions.changes-requested.escalateAfter","reactions.bugbot-comments.auto","reactions.bugbot-comments.action","reactions.bugbot-comments.message","reactions.bugbot-comments.escalateAfter","reactions.merge-conflicts.auto","reactions.merge-conflicts.action","reactions.merge-conflicts.message","reactions.merge-conflicts.escalateAfter","reactions.approved-and-green.auto","reactions.approved-and-green.action","reactions.approved-and-green.priority","reactions.approved-and-green.message","reactions.agent-idle.auto","reactions.agent-idle.action","reactions.agent-idle.message","reactions.agent-idle.retries","reactions.agent-idle.escalateAfter","reactions.agent-stuck.auto","reactions.agent-stuck.action","reactions.agent-stuck.priority","reactions.agent-stuck.threshold","reactions.agent-needs-input.auto","reactions.agent-needs-input.action","reactions.agent-needs-input.priority","reactions.agent-exited.auto","reactions.agent-exited.action","reactions.agent-exited.priority","reactions.all-complete.auto","reactions.all-complete.action","reactions.all-complete.priority","reactions.all-complete.includeSummary","configPath"]}
```

### Additional regex, file-loading and persisted-metadata receipts

Saved receipt: `/tmp/aozr/evidence/extra-probes.log` (embedded before scratch cleanup).

```json
{"createdAtRegexSourceEqual":true,"basePatternLength":250,"tipPatternLength":250,"sentinel":"2024-02-29T01:23Z"}
{"syntheticYamlCases":10,"bothAccepted":8,"bothRejected":2,"mismatches":0,"sentinel":"projects: {}"}
{"persistedMetadataCases":22,"baseAccepted":8,"tipAccepted":8,"mismatches":0,"sentinel":"report_ok"}
```

## Zod 4 migration audit

Source examined: installed Zod 3.25.76 `src/v3/types.ts`, parser helpers and `v3/types.d.ts`/`ZodError.d.ts`; installed Zod 4.6.7 `src/v4/core/schemas.ts`, `util.ts`, `regexes.ts`, classic schema APIs and their shipped declarations/error declarations. The following concerns were traced into AO, rather than assumed applicable merely because the migration guide lists them.

| Concern | AO usage and judgment |
|---|---|
| `.default()` vs `.prefault()` | Both object defaults requiring inner parsing correctly use prefault. Other scalar defaults have identical input/output. Empty array/record defaults need no element parsing; the committed per-parse identity test passes. Entries supplied in plugin arrays still receive enabled=true. |
| Defaults inside optional/partial | The unreachable decomposer object default is correctly removed, while the empty decomposer object still fills its fields. ReactionFieldsSchema separates un-defaulted overrides from defaulted globals. Explicit known undefined values remain stable in the shipped implementation. |
| `z.record` arity and enum keys | String key schemas are supplied, including the existing project-ID regex; no enum-key record exists, so Zod 4's enum exhaustiveness is not triggered. **Compatibility is incomplete:** B-1/B-3/B-4. |
| Unknown keys | Strip remains the default at root/project/defaults, role wrapper/default role, webhook, decomposer, plugin entry and reaction objects. Loose applies to tracker/SCM/notifier and both agent-specific schema kinds. Feedback remains strict. **Loose undefined keys regress:** B-2. |
| `.extend`/`.merge`, ordering | The new extend replaces auto/action at their original positions; successful plain-data parses keep schema order. No merge call is used here. Canonical comparison catches the actual added/dropped keys. Tests' deep equality alone does not guarantee key order (m-1). |
| Custom errors | Existing AO regex strings and custom refinement messages remain. No old errorMap/invalid_type_error/required_error option remains in these schemas. Message arguments still work. Number unions use the new error callback and its `errors` shape; measured wrong-type messages are readable. |
| `.refine`/`.superRefine` | The integer refinement preserves all Number.isInteger values, including unsafe positive integers. Plugin checks retain their paths. Both builds run the outer SCM check after a continuable nested non-positive number issue, and both skip it after an aborting nested wrong-type issue. |
| Transform/pipe/catch/preprocess | Project permissions still map skip to permissionless; role permissions retain skip as before. Feedback whitespace normalization and pipe-to-nonempty behave equally. No catch or preprocess is used. |
| String formats | No URL/email/UUID format validator is used in these two modules. Session/project/report/dedupe regexes remain. createdAt's replacement pattern exactly matches Zod 3; direct use of Zod 4 datetime would lose seconds-omitted/compact/large-offset forms. |
| Numbers | General numbers restore both infinities; readyThresholdMs restores positive infinity only; finite bounds still reject non-finite values. Unsafe integer maxBodyBytes is restored. NaN rejects, -0 is preserved in direct validator outputs. The plain confidence number remains constrained to 0..1. |
| Enum/literal/union/discriminatedUnion | Enum alternatives are stable. Role literal skip and the number unions were tested. The new infinity literal adds no finite values. Discriminated unions are unused. Error codes and nested union representation change as documented below. |
| `unknown`/`any`, lazy, nullable | No explicit unknown/any schema fields, lazy schemas or nullable combinations occur here. Loose unknown-key handling is nevertheless relevant and is B-2. Null remains invalid for the declared optional fields. |
| ZodError | `.issues` is present on both; `.errors` disappears in Zod 4. `.flatten()`/`.format()` remain callable and were probed. `instanceof` each installed ZodError remains true; `.message` still exposes the issue JSON. No production AO consumer branches on these Zod classes/codes/texts. |

## Types and consumers

Only feedback schemas export inferred data types. Both z.infer output shapes and the z.input shapes still assign both ways to the expected title/body/evidence/session/source/confidence shape. Public validateConfig/loadConfig still return the hand-written OrchestratorConfig type. Hand-written config types and the core export surface did not change. Both package-wide typechecks and separate strict compile-time type probes pass. No production any or cast was added to force this migration through the compiler; the existing validateConfig cast predates it. Test-only casts inspect caught unknown errors and construct an excess-key payload.

All packages/docs were searched for schema imports, z.infer/z.input, ZodError, `.errors`, `.issues`, flatten/format, text/code dependencies and validation wrappers. Config consumers include CLI start/session/spawn/status/send/doctor/review-check/verify/lifecycle-worker, core exports and config tests; feedback schema/type uses are its own module, exports and tests. No other package needed a code change. Generic `.errors` hits in cleanup/recovery/GraphQL are unrelated result objects. New `.issues` uses are tests; `issue.errors` in firstOptionMessage is intentionally Zod 4's union shape.

The first scratch type probe used a direct package-file import instead of the same package specifier and an overly strict union type-identity predicate. It failed on the base too. The corrected probe imports `zod` from the core package and checks mutual assignability; its source and successful receipts are reproduced below. This was a probe correction, not a production type regression.

### Strict data-type compatibility checks, base

Saved receipt: `/tmp/aozr/evidence/base-types-corrected.exit` (embedded before scratch cleanup).

```text
base type assertions exit=0
```

### Strict data-type compatibility checks, tip-equivalent upgrade

Saved receipt: `/tmp/aozr/evidence/upgrade-types-corrected.exit` (embedded before scratch cleanup).

```text
upgrade type assertions exit=0
```

## Error text and shape audit

AO-owned text remains in the emitted errors: plugin-field validation, installed-plugin requirements, sessionPrefix/project-ID messages and duplicate-project/prefix errors. CLI doctor at `packages/cli/src/commands/doctor.ts:376` prints its existing wrapper plus `err.message`; start and several other CLI error surfaces similarly print/pass through messages, while status/send/verify have broad fallback catches. These paths expose or swallow Zod's changed messages but do not **depend on a particular Zod message/code/shape to choose behavior**. Existing test oracles were not rewritten; the diff only adds tests.

Measured changes include Required to the new expected-type wording; enum/literal codes to invalid_value; project keys to invalid_key with the AO regex text nested under issues and no validation of the invalid key's value; numeric/array/string bound wording and origin/type fields; old unionErrors/ZodError arrays to errors/issue arrays; NaN spelling; strict unknown-key wording; and non-finite confidence rejection before bounds. The maxBodyBytes custom integer refinement additionally changes the issue code from invalid_type(integer/float) to custom while preserving its message. That particular shape change was not explicitly listed in the implementer's report; there is no AO consumer relying on its old code.

The number union now wraps wrong-type and NaN errors in invalid_union; a finite negative readyThresholdMs produces the original branch's bound issue directly. Thus not every union failure is wrapped. This is visible in the actual receipts. No unmodified production/test/doc dependency on the old messages/codes was found. These permitted Zod-generated changes do not themselves justify a blocking finding. The custom project-ID text remains visible in the complete JSON printed by doctor (open question 2).

### Measured error messages and shapes

Saved receipt: `/tmp/aozr/evidence/error-receipts.txt` (embedded before scratch cleanup).

```text
error cases 16
missing
base [{"code": "invalid_type", "expected": "string", "received": "undefined", "path": ["projects", "app", "repo"], "message": "Required"}]
 errors alias True instanceof ZodError True
tip [{"expected": "string", "code": "invalid_type", "path": ["projects", "app", "repo"], "message": "Invalid input: expected string, received undefined"}]
 errors alias False instanceof ZodError True
enum
base [{"received": "x", "code": "invalid_enum_value", "options": ["isolated", "project"], "path": ["projects", "app", "orchestratorWorkspaceMode"], "message": "Invalid enum value. Expected 'isolated' | 'project', received 'x'"}]
 errors alias True instanceof ZodError True
tip [{"code": "invalid_value", "values": ["isolated", "project"], "path": ["projects", "app", "orchestratorWorkspaceMode"], "message": "Invalid option: expected one of \"isolated\"|\"project\""}]
 errors alias False instanceof ZodError True
key
base [{"validation": "regex", "code": "invalid_string", "message": "Project ID must match [a-zA-Z0-9_-]+ (no dots, slashes, or special characters)", "path": ["projects", "bad.key"]}, {"code": "invalid_type", "expected": "string", "received": "undefined", "path": ["projects", "bad.key", "repo"], "message": "Required"}, {"code": "invalid_type", "expected": "string", "received": "undefined", "path": ["projects", "bad.key", "path"], "message": "Required"}]
 errors alias True instanceof ZodError True
tip [{"code": "invalid_key", "origin": "record", "issues": [{"origin": "string", "code": "invalid_format", "format": "regex", "pattern": "/^[a-zA-Z0-9_-]+$/", "path": [], "message": "Project ID must match [a-zA-Z0-9_-]+ (no dots, slashes, or special characters)"}], "path": ["projects", "bad.key"], "message": "Invalid key in record"}]
 errors alias False instanceof ZodError True
wrongNumber
base [{"code": "invalid_type", "expected": "number", "received": "string", "path": ["port"], "message": "Expected number, received string"}]
 errors alias True instanceof ZodError True
tip [{"code": "invalid_union", "errors": [[{"expected": "number", "code": "invalid_type", "path": [], "message": "Invalid input: expected number, received string"}], [{"code": "invalid_value", "values": [null, null], "path": [], "message": "Invalid option: expected one of Infinity|-Infinity"}]], "path": ["port"], "message": "Invalid input: expected number, received string"}]
 errors alias False instanceof ZodError True
fraction
base [{"code": "invalid_type", "expected": "integer", "received": "float", "message": "Expected integer, received float", "path": ["projects", "app", "scm", "webhook", "maxBodyBytes"]}]
 errors alias True instanceof ZodError True
tip [{"code": "custom", "path": ["projects", "app", "scm", "webhook", "maxBodyBytes"], "message": "Expected integer, received float"}]
 errors alias False instanceof ZodError True
bounds
base [{"code": "too_big", "maximum": 5, "type": "number", "inclusive": true, "exact": false, "message": "Number must be less than or equal to 5", "path": ["projects", "app", "decomposer", "maxDepth"]}]
 errors alias True instanceof ZodError True
tip [{"origin": "number", "code": "too_big", "maximum": 5, "inclusive": true, "path": ["projects", "app", "decomposer", "maxDepth"], "message": "Too big: expected number to be <=5"}]
 errors alias False instanceof ZodError True
ready
base [{"code": "too_small", "minimum": 0, "type": "number", "inclusive": true, "exact": false, "message": "Number must be greater than or equal to 0", "path": ["readyThresholdMs"]}]
 errors alias True instanceof ZodError True
tip [{"origin": "number", "code": "too_small", "minimum": 0, "inclusive": true, "path": ["readyThresholdMs"], "message": "Too small: expected number to be >=0"}]
 errors alias False instanceof ZodError True
nested
base [{"code": "too_small", "minimum": 0, "type": "number", "inclusive": false, "exact": false, "message": "Number must be greater than 0", "path": ["projects", "app", "scm", "webhook", "maxBodyBytes"]}, {"code": "custom", "message": "SCM config requires either 'plugin' (for built-ins) or 'package'/'path' (for external plugins)", "path": ["projects", "app", "scm"]}]
 errors alias True instanceof ZodError True
tip [{"origin": "number", "code": "too_small", "minimum": 0, "inclusive": false, "path": ["projects", "app", "scm", "webhook", "maxBodyBytes"], "message": "Too small: expected number to be >0"}, {"code": "custom", "message": "SCM config requires either 'plugin' (for built-ins) or 'package'/'path' (for external plugins)", "path": ["projects", "app", "scm"]}]
 errors alias False instanceof ZodError True
pluginAborted
base [{"code": "invalid_type", "expected": "string", "received": "number", "path": ["projects", "app", "tracker", "path"], "message": "Expected string, received number"}]
 errors alias True instanceof ZodError True
tip [{"expected": "string", "code": "invalid_type", "path": ["projects", "app", "tracker", "path"], "message": "Invalid input: expected string, received number"}]
 errors alias False instanceof ZodError True
roleLiteral
base [{"code": "invalid_union", "unionErrors": [{"issues": [{"received": "x", "code": "invalid_enum_value", "options": ["permissionless", "default", "auto-edit", "suggest"], "path": ["projects", "app", "orchestrator", "agentConfig", "permissions"], "message": "Invalid enum value. Expected 'permissionless' | 'default' | 'auto-edit' | 'suggest', received 'x'"}], "name": "ZodError"}, {"issues": [{"received": "x", "code": "invalid_literal", "expected": "skip", "path": ["projects", "app", "orchestrator", "agentConfig", "permissions"], "message": "Invalid literal value, expected \"skip\""}], "name": "ZodError"}], "path": ["projects", "app", "orchestrator", "agentConfig", "permissions"], "message": "Invalid input"}]
 errors alias True instanceof ZodError True
tip [{"code": "invalid_union", "errors": [[{"code": "invalid_value", "values": ["permissionless", "default", "auto-edit", "suggest"], "path": [], "message": "Invalid option: expected one of \"permissionless\"|\"default\"|\"auto-edit\"|\"suggest\""}], [{"code": "invalid_value", "values": ["skip"], "path": [], "message": "Invalid input: expected \"skip\""}]], "path": ["projects", "app", "orchestrator", "agentConfig", "permissions"], "message": "Invalid input"}]
 errors alias False instanceof ZodError True
nullRecord
base [{"code": "invalid_type", "expected": "object", "received": "null", "path": ["projects"], "message": "Expected object, received null"}]
 errors alias True instanceof ZodError True
tip [{"expected": "record", "code": "invalid_type", "path": ["projects"], "message": "Invalid input: expected record, received null"}]
 errors alias False instanceof ZodError True
numberNaN
base [{"code": "invalid_type", "expected": "number", "received": "nan", "path": ["port"], "message": "Expected number, received nan"}]
 errors alias True instanceof ZodError True
tip [{"code": "invalid_union", "errors": [[{"expected": "number", "code": "invalid_type", "received": "NaN", "path": [], "message": "Invalid input: expected number, received NaN"}], [{"code": "invalid_value", "values": [null, null], "path": [], "message": "Invalid option: expected one of Infinity|-Infinity"}]], "path": ["port"], "message": "Invalid input: expected number, received NaN"}]
 errors alias False instanceof ZodError True
readyNegInfinity
base [{"code": "too_small", "minimum": 0, "type": "number", "inclusive": true, "exact": false, "message": "Number must be greater than or equal to 0", "path": ["readyThresholdMs"]}]
 errors alias True instanceof ZodError True
tip [{"code": "invalid_union", "errors": [[{"expected": "number", "code": "invalid_type", "received": "-Infinity", "path": [], "message": "Invalid input: expected number, received -Infinity"}], [{"code": "invalid_value", "values": [null], "path": [], "message": "Invalid input: expected Infinity"}]], "path": ["readyThresholdMs"], "message": "Invalid input: expected number, received -Infinity"}]
 errors alias False instanceof ZodError True
decomposerInfinity
base [{"code": "too_big", "maximum": 5, "type": "number", "inclusive": true, "exact": false, "message": "Number must be less than or equal to 5", "path": ["projects", "app", "decomposer", "maxDepth"]}]
 errors alias True instanceof ZodError True
tip [{"expected": "number", "code": "invalid_type", "received": "Infinity", "path": ["projects", "app", "decomposer", "maxDepth"], "message": "Invalid input: expected number, received Infinity"}]
 errors alias False instanceof ZodError True
feedback
base [{"code": "too_small", "minimum": 1, "type": "string", "inclusive": true, "exact": false, "message": "String must contain at least 1 character(s)", "path": ["title"]}, {"code": "too_small", "minimum": 1, "type": "array", "inclusive": true, "exact": false, "message": "Array must contain at least 1 element(s)", "path": ["evidence"]}, {"code": "not_finite", "message": "Number must be finite", "path": ["confidence"]}, {"code": "too_big", "maximum": 1, "type": "number", "inclusive": true, "exact": false, "message": "Number must be less than or equal to 1", "path": ["confidence"]}]
tip [{"origin": "string", "code": "too_small", "minimum": 1, "inclusive": true, "path": ["title"], "message": "Too small: expected string to have >=1 characters"}, {"origin": "array", "code": "too_small", "minimum": 1, "inclusive": true, "path": ["evidence"], "message": "Too small: expected array to have >=1 items"}, {"expected": "number", "code": "invalid_type", "received": "Infinity", "path": ["confidence"], "message": "Invalid input: expected number, received Infinity"}]
feedback
base [{"code": "unrecognized_keys", "keys": ["extra", "other"], "path": [], "message": "Unrecognized key(s) in object: 'extra', 'other'"}]
tip [{"code": "unrecognized_keys", "keys": ["extra", "other"], "path": [], "message": "Unrecognized keys: \"extra\", \"other\""}]
```

## Dependency and offline upgrade

The package specifier is `^4.6.6`; the lock and fresh installed package resolve 4.6.7. The dependency/lock diff is confined to core's Zod dependency, its package integrity and snapshot. Parsed lock data excluding those entries is identical and nonempty, with yaml@2.8.3 as the known sentinel. No other package.json declares a Zod dependency/peer; the fresh tip virtual store has one Zod package version, 4.6.7. Zod's own bundled v3 compatibility entry is not a second installed dependency.

The scratch upgrade starts from an offline frozen base install and complete base build, applies tip's manifest/lock/config/feedback files, repeats offline frozen install and complete build, and successfully runs the built CLI --help and `session ls` against an explicit scratch `projects: {}` config. No real state/config was used. The latter command has no projects or sessions to launch and exits successfully. Other package versions do not move. pnpm leaves the old zod@3.25.76 directory in the upgraded virtual store; the **active core link** and `pnpm why` resolve 4.6.7. A fresh tip has only the new version. This residual disk directory is not a runtime dependency or a build failure.

The install/build sequence passes; the resident-process limitation is M-1.

### Non-Zod lock equality and active installed versions

Saved receipt: `/tmp/aozr/evidence/dependency-probe.log` (embedded before scratch cleanup).

```json
{"nonZodLockDataEqual":true,"basePackages":436,"tipPackages":436,"sentinel":"yaml@2.8.3"}
[{"copy":"base","installed":"3.25.76"},{"copy":"tip","installed":"4.6.7"},{"copy":"upgrade","installed":"4.6.7"}]
```

### Fresh tip virtual-store Zod version

Saved receipt: `/tmp/aozr/evidence/tip-zod-tree.txt` (embedded before scratch cleanup).

```text
zod@4.6.7
```

### Upgrade command exits

Saved receipt: `/tmp/aozr/evidence/upgrade-run.log` (embedded before scratch cleanup).

```text
base-install exit=0
base-build exit=0
tip-install exit=0
tip-build exit=0
help exit=0
why exit=0
cli-config exit=0
```

### Upgrade virtual-store directory comparison

Saved receipt: `/tmp/aozr/evidence/upgrade-package-diff.txt` (embedded before scratch cleanup).

```text
nonempty base 380 nonempty tip 381 known sentinel yaml@2.8.3 present on both
removed []
added ['zod@4.6.7']
```

### Upgrade active dependency

Saved receipt: `/tmp/aozr/evidence/upgrade-why.log` (embedded before scratch cleanup).

```text
Legend: production dependency, optional only, dev only

@aoagents/ao-core@0.2.0 /tmp/aozr/upgrade/packages/core

dependencies:
zod 4.6.7
```

### Built CLI help

Saved receipt: `/tmp/aozr/evidence/upgrade-help.log` (embedded before scratch cleanup).

```text
Usage: ao [options] [command]

Agent Orchestrator — manage parallel AI coding agents

Options:
  -V, --version                          output the version number
  -h, --help                             display help for command

Commands:
  init                                   [deprecated] Use 'ao start' instead — it auto-creates config on first run
  start [options] [project]              Start the orchestrator agent (auto-creates config on first run, adds projects by path/URL)
  stop [options] [project]               Stop the orchestrator agent and lifecycle worker
  status [options]                       Show all sessions with branch, activity, PR, and CI status
  spawn [options] [first] [second]       Spawn a single agent session
  batch-spawn <issues...>                Spawn sessions for multiple issues with duplicate detection
  session                                Session management (ls, attach, kill, cleanup, restore, relaunch, claim-pr)
  send [options] <session> [message...]  Send a message to a session with busy detection and retry; an OpenCode session with a stored session ID gets it through the OpenCode API (session.prompt, delivery queue)
  review-check [options] [project]       Check PRs for review comments and trigger agents to address them
  lifecycle-worker [options] <project>   Internal lifecycle polling worker
  verify [options] [issue]               Mark an issue as verified (or failed) after checking the fix on staging
  doctor [options]                       Run install, environment, and runtime health checks
  config-help                            Show config schema and guide for creating agent-orchestrator.yaml
  help [command]                         display help for command
```

The config-loading `session ls` command produced no output for an empty project map; its successful exit is included in `upgrade-run.log` above. Audit: **not run** (network prohibited). The implementer's audit claim is not an independently measured receipt of this review.

## Test gates and regression sensitivity

Both independent scratch archives completed install, build, typecheck, lint and the complete recursive test suite successfully. The first base full run failed nine hook tests because my curated PATH omitted flock. After adding the link, both affected package reruns pass; a second complete base run also passes. Tip's complete run used the corrected PATH and passed. This was an environment correction; no test/source workaround was applied. The five existing lint warnings are unchanged (plus ESLint's existing .eslintignore deprecation notice).

Core increases only by the new 19 config pin tests and three feedback tests. Every other package count is equal. Core's pre-existing expected failure remains; red mode exposes the same 21 named defects on both sides, R2=15 and R3=6. Nonzero red exits are expected. SCM's five real GitHub integration cases skip without credentials, and the integration package skips its live-agent blocks (24 tests). Private tmux integration and shell-pane cases did run. The ao wrapper package has no test script.

Putting the two tip test files on the built base produces exactly 28 passes and five failures. Those five are precisely the newly asserted Zod 4 error text/shape cases, including the record-key issue wrapper. The feedback datetime acceptance and numeric/default value pins pass on base as required.

Nine meaningful behavior fixes were undone independently in scratch source and **core was rebuilt before every run**. Each builds and makes at least one new test fail. For the two object-default reversions the new static API expects an output value; the scratch mutation uses a z.output assertion to pass `{}` and exercise its runtime behavior; no such assertion was introduced into the reviewed commit. The source API edits (record's required key parameter, passthrough-to-loose, custom issue enum spelling and confidence's redundant finite check) are not nine further behavioral fixes: arity is compiler-checked, the deprecated aliases remain callable, and finite is redundant in Zod 4. Actual record/loose compatibility gaps are the blocking findings.

All three wrong fixes described in m-1 pass the targeted tests; additional probes prove their semantic errors. After all mutations the original sources were restored, rebuilt and the 33 targeted tests pass. All mutation sources and the runner are included below.

### Build/type/lint summaries and mismatch classification

Saved receipt: `/tmp/aozr/evidence/diff-summary.txt` (embedded before scratch cleanup).

```text
config mismatch groups {"record-class": 5, "record-inherited": 5, "record-symbol": 5, "unknown": 6, "valid-random": 1030}
accepted-value changes 1041
acceptance changes 10
base install exit=0 build exit=0 typecheck exit=0 lint exit=0
tip install exit=0 build exit=0 typecheck exit=0 lint exit=0
```

### Tip lint warnings (same positions on base)

Saved receipt: `/tmp/aozr/evidence/tip-lint.log` (embedded before scratch cleanup).

```text

> agent-orchestrator@0.1.0 lint /tmp/aozr/tip
> eslint .

(node:3944136) ESLintIgnoreWarning: The ".eslintignore" file is no longer supported. Switch to using the "ignores" property in "eslint.config.js": https://eslint.org/docs/latest/use/configure/migration-guide#ignore-files
(Use `node --trace-warnings ...` to show where the warning was created)

/tmp/aozr/tip/packages/cli/src/commands/spawn.ts
  333:24  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

/tmp/aozr/tip/packages/core/src/activity-log.ts
  91:31  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

/tmp/aozr/tip/packages/core/src/plugin-registry.ts
  232:7  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

/tmp/aozr/tip/packages/core/src/session-manager.ts
  3232:11  warning  Unexpected console statement  no-console
  3239:9   warning  Unexpected console statement  no-console

✖ 5 problems (0 errors, 5 warnings)
```

### Complete-suite counts, same-ID names and new tests on base

Saved receipt: `/tmp/aozr/evidence/test-receipts.txt` (embedded before scratch cleanup).

```text
base-test-fixed exit=0
packages/core test:       Tests  1847 passed | 1 expected fail (1848)
packages/plugins/agent-gemini test:       Tests  99 passed (99)
packages/plugins/agent-codex test:       Tests  318 passed (318)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/runtime-herdr test:       Tests  272 passed (272)
packages/plugins/agent-claude-code test:       Tests  368 passed (368)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:       Tests  365 passed (365)
packages/plugins/runtime-tmux test:       Tests  116 passed (116)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  447 passed (447)
tip-test exit=0
packages/core test:       Tests  1869 passed | 1 expected fail (1870)
packages/plugins/agent-gemini test:       Tests  99 passed (99)
packages/plugins/agent-codex test:       Tests  318 passed (318)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/runtime-herdr test:       Tests  272 passed (272)
packages/plugins/agent-claude-code test:       Tests  368 passed (368)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:       Tests  365 passed (365)
packages/plugins/runtime-tmux test:       Tests  116 passed (116)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  447 passed (447)
base red failures 21 r2 files 7 r3/other 14
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, isAlive of the old launch answers false
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > destroy of the first launch keeps a replacement of the ID that started in the same second
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > isAlive of the first launch answers false while a same-second replacement of the ID runs
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-2: a replacement between the create and its launch keys > create: a replacement of the ID made directly after the create command never receives the first launch's keys
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-5: another server answers at the recorded socket path > isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-5: another server answers at the recorded socket path > isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
src/__tests__/same-id-defects.test.ts > [same-id R2] D-B: a call finds the tmux server only through its environment > destroy from another server's environment does not end that server's session of the same name
src/__tests__/same-id-defects.test.ts > [same-id R2] D-B: a call finds the tmux server only through its environment > isAlive answers true for a live session when the caller's environment names another server
src/__tests__/same-id-defects.test.ts > [same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/__tests__/same-id-defects.test.ts > [same-id R2] F-5: destroy by name ends another launch of the same name > destroy keeps a newer session of the same name that another launch created
src/__tests__/same-id-defects.test.ts > [same-id R2] F-7: a hidden socket of a running server reads as no server > isAlive does not report 'no server' while the recorded server process still runs
src/__tests__/same-id-defects.test.ts > [same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree > create does not remove a worktree that another launch made at the path during the checkout
src/__tests__/same-id-defects.test.ts > [same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files > restore: postCreate keeps the files of another launch that took the record and the path during the git add
src/__tests__/same-id-defects.test.ts > [same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files > spawn: postCreate keeps the files of another launch that took the record and the path during the git add
src/__tests__/same-id-defects.test.ts > [same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it > kill and restore of one ID: the active record at the end names a live runtime
src/__tests__/same-id-defects.test.ts > [same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it > kill and restore of one ID: the active record at the end still has its worktree
src/same-id-defects.test.ts > [same-id R2] D-B: the codex pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/same-id-defects.test.ts > [same-id R2] D-B: the gemini pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/same-id-defects.test.ts > [same-id R2] D-B: the opencode pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/same-id-reuse-window.test.ts > [same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get > a rollback during another spawn's session.get does not remove the session that the spawn then stores
tip red failures 21 r2 files 7 r3/other 14
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, isAlive of the old launch answers false
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > destroy of the first launch keeps a replacement of the ID that started in the same second
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-1: two launches of an ID in the same second > isAlive of the first launch answers false while a same-second replacement of the ID runs
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-2: a replacement between the create and its launch keys > create: a replacement of the ID made directly after the create command never receives the first launch's keys
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-5: another server answers at the recorded socket path > isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
src/__tests__/same-id-defects-r2.test.ts > [same-id R2] B-5: another server answers at the recorded socket path > isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
src/__tests__/same-id-defects.test.ts > [same-id R2] D-B: a call finds the tmux server only through its environment > destroy from another server's environment does not end that server's session of the same name
src/__tests__/same-id-defects.test.ts > [same-id R2] D-B: a call finds the tmux server only through its environment > isAlive answers true for a live session when the caller's environment names another server
src/__tests__/same-id-defects.test.ts > [same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/__tests__/same-id-defects.test.ts > [same-id R2] F-5: destroy by name ends another launch of the same name > destroy keeps a newer session of the same name that another launch created
src/__tests__/same-id-defects.test.ts > [same-id R2] F-7: a hidden socket of a running server reads as no server > isAlive does not report 'no server' while the recorded server process still runs
src/__tests__/same-id-defects.test.ts > [same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree > create does not remove a worktree that another launch made at the path during the checkout
src/__tests__/same-id-defects.test.ts > [same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files > restore: postCreate keeps the files of another launch that took the record and the path during the git add
src/__tests__/same-id-defects.test.ts > [same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files > spawn: postCreate keeps the files of another launch that took the record and the path during the git add
src/__tests__/same-id-defects.test.ts > [same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it > kill and restore of one ID: the active record at the end names a live runtime
src/__tests__/same-id-defects.test.ts > [same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it > kill and restore of one ID: the active record at the end still has its worktree
src/same-id-defects.test.ts > [same-id R2] D-B: the codex pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/same-id-defects.test.ts > [same-id R2] D-B: the gemini pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/same-id-defects.test.ts > [same-id R2] D-B: the opencode pane read finds the tmux server only through the environment > isProcessRunning finds the agent on the server that the handle names, from another server's environment
src/same-id-reuse-window.test.ts > [same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get > a rollback during another spawn's session.get does not remove the session that the spawn then stores
red names equal: True
new tests on base: 28 passed 5 failed
Config Zod pins - records rejects a project ID outside the key pattern with AO's text inside Zod's key issue
Config Zod pins - numbers reports a wrong type for a number field with the text of z.number()
Config Zod pins - error texts still runs the plugin field check beside a webhook number issue
Config Zod pins - error texts pins Zod's own texts for a missing field and an unknown option
feedback report store rejects an unknown input key with Zod's text
```

### Correct round classification of red failures

Saved receipt: `/tmp/aozr/evidence/red-summary.txt` (embedded before scratch cleanup).

```text
base failures 21 R2 15 R3 6
tip failures 21 R2 15 R3 6
both contain the R3 F-3 issue reuse case: True
names equal True
```

### Mutation sensitivity and restored tip tests

Saved receipt: `/tmp/aozr/evidence/mutation-summary.txt` (embedded before scratch cleanup).

```text
undo-agent-prefault passed 32 failed 1
  Config Zod pins - defaults fills agentConfig with its inner default when a project has none
undo-defaults-prefault passed 31 failed 2
  Config Zod pins - defaults fills defaults with every inner default when the config has none
  Config Zod pins - defaults gives each parse its own default arrays and objects
undo-decomposer passed 32 failed 1
  Config Zod pins - defaults leaves an absent decomposer absent
undo-reaction-override passed 30 failed 3
  Config Zod pins - project reaction overrides keeps only the fields that an override names
  Config Zod pins - unknown keys drops unknown keys of the top level, a project and the other blocks
  Config Zod pins - numbers accepts the YAML infinities where Zod 3 accepted them
undo-number-union passed 31 failed 2
  Config Zod pins - numbers accepts the YAML infinities where Zod 3 accepted them
  Config Zod pins - numbers reports a wrong type for a number field with the text of z.number()
undo-ready-infinity passed 32 failed 1
  Config Zod pins - numbers accepts the YAML infinities where Zod 3 accepted them
undo-escalate-infinity passed 32 failed 1
  Config Zod pins - numbers accepts the YAML infinities where Zod 3 accepted them
undo-large-integer passed 31 failed 2
  Config Zod pins - numbers accepts an integer maxBodyBytes above Number.MAX_SAFE_INTEGER
  Config Zod pins - numbers rejects a fractional maxBodyBytes with Zod 3's text
undo-createdAt passed 32 failed 1
  feedback report store reads every createdAt form that Zod 3's datetime check accepted
wrong-prefault-add-undefined passed 33 failed 0
wrong-reaction-strip-undefined passed 33 failed 0
wrong-ready-negative passed 33 failed 0
restored tip: 33 passed 0 failed
```

### Mutation build/test command exits

Saved receipt: `/tmp/aozr/evidence/mutations-run.log` (embedded before scratch cleanup).

```text
undo-agent-prefault build=0 test=1
undo-defaults-prefault build=0 test=1
undo-decomposer build=0 test=1
undo-reaction-override build=0 test=1
undo-number-union build=0 test=1
undo-ready-infinity build=0 test=1
undo-escalate-infinity build=0 test=1
undo-large-integer build=0 test=1
undo-createdAt build=0 test=1
wrong-prefault-add-undefined build=0 test=0
wrong-reaction-strip-undefined build=0 test=0
wrong-ready-negative build=0 test=0
restore build=0
```

### Secret scanning

Saved receipt: `/tmp/aozr/evidence/gitleaks-plain.log` (embedded before scratch cleanup).

```text

    ○
    │╲
    │ ○
    ○ ░
    ░    gitleaks

8:25AM INF 1 commits scanned.
8:25AM INF scan completed in 28.9ms
8:25AM INF no leaks found
```

### Secret scan exit

Saved receipt: `/tmp/aozr/evidence/gitleaks.exit` (embedded before scratch cleanup).

```text
gitleaks exit=0
```

## Landing readiness and report open questions

Both required merge-tree commands complete without conflict; no conflicting paths exist. They write tree objects, not a branch ref. No origin/main, fetch, pull, rebase, merge commit or branch replay was used.

1. **4.6.7 lock with ^4.6.6:** keep it. The locked version satisfies the owner-approved range and is above the patched floor supplied by the brief; offline frozen install and the actual build validate that combination. No reason was found to fetch/pin 4.6.6. Registry freshness and audit were not rechecked because network is prohibited.
2. **Project-ID top-level error:** accept the changed Zod wrapper. The owner's implementer brief explicitly permits Zod-generated message changes, the AO-owned regex text remains in the nested issues printed in the JSON, and no consumer depends on the former outer text/code. This does not excuse B-1's silently skipped reserved-key values.
3. **Metadata hook branch parsing:** an independent operational issue, not part of the Zod patch. The specific legacy `.claude/metadata-updater.sh` is absent in this review worktree, so that old hook's defect was **not reproduced**. The installed ~/.ao/bin/git wrapper inspected read-only derives the actual symbolic HEAD after checkout/switch, rather than taking a file path as the branch. Use git restore for file restoration; don't expand this focused patch to change runtime hooks. No checkout/switch was used here.

What is correct: dependency isolation, object prefault handling, decomposer absence, separation of reaction overrides, infinity and unsafe-integer acceptance, strict feedback behavior and whitespace normalization, exact legacy datetime regex, preserved data types, ordinary YAML parses, compilation and existing tests. The remaining compatibility gaps and the live restart step prevent approval under the supplied contract.

### Merge with current local main

Saved receipt: `/tmp/aozr/evidence/merge-main.log` (embedded before scratch cleanup).

```text
9d1d49d46d6b33f6fb630829ed02fefd1e47a0fa
```

### Merge with main exit

Saved receipt: `/tmp/aozr/evidence/merge-main.exit` (embedded before scratch cleanup).

```text
main exit=0
```

### Merge with fit-2b

Saved receipt: `/tmp/aozr/evidence/merge-fit2b.log` (embedded before scratch cleanup).

```text
917173c278d624c3b11d928ae9f015596b178a03
```

### Merge with fit-2b exit

Saved receipt: `/tmp/aozr/evidence/merge-fit2b.exit` (embedded before scratch cleanup).

```text
fit2b exit=0
```

### Initial commit and final HEAD comparison

Saved receipt: `/tmp/aozr/evidence/head.txt` (embedded before scratch cleanup).

```text
486ddb0d fix(core): upgrade zod to 4.6.6 and keep the config parse unchanged
```

### HEAD unchanged

Saved receipt: `/tmp/aozr/evidence/head-compare.txt` (embedded before scratch cleanup).

```text
HEAD unchanged exit=0
```

## Cleanup evidence

The process scan after all tests/probes finds no remaining process with a scratch HOME or a Node cwd under the scratch tree. The private named tmux server is gone and scratch UNIX socket scan is empty. The remaining stale aozr-tests socket file is removed after the no-server check. No default-server tmux command was issued. The early harness generation mistake created shared input subtrees and a stalled scratch Node process; only that exact process was terminated, after verifying its HOME in /proc. No process was selected for killing by name pattern, and no live AO worker/session was signalled.

The real-state find output is preserved below. These are concurrent live AO bookkeeping surfaces: Nexus deliveries/session activity, this managed review session ao-87, the ao-orchestrator session, and their session directories. Reviewer-issued commands never write these paths; builds/tests/probes use the scratch HOME and no real AO command runs. The precise external writer PID was not traced; attribution is to the concurrent fleet/managed-session bookkeeping, not a claim that stat proves a particular PID. No listed path is attributed to a scratch probe. The review did not read another pane or modify the live configuration files. ~/.ao/bin's before/after full-iso listings are byte-for-byte equal.

All receipts cited above, source needed to reproduce the harness, and final cleanup receipts are embedded in this file before removing the scratch tree. The final deletion/absence check is recorded after the appendices.

### Initial ~/.ao/bin listing

Saved receipt: `/tmp/aozr/evidence/ao-bin-before.txt` (embedded before scratch cleanup).

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

### Final ~/.ao/bin listing

Saved receipt: `/tmp/aozr/evidence/ao-bin-after.txt` (embedded before scratch cleanup).

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

### Listing comparison

Saved receipt: `/tmp/aozr/evidence/ao-bin-compare.txt` (embedded before scratch cleanup).

```text
ao-bin cmp exit=0
```

### Own remaining processes (empty)

Saved receipt: `/tmp/aozr/evidence/proc-precleanup.txt` (embedded before scratch cleanup).

```text

```

### Private tmux server check

Saved receipt: `/tmp/aozr/evidence/private-tmux.log` (embedded before scratch cleanup).

```text
no server running on /tmp/tmux-44402/aozr-tests
```

### Remaining scratch sockets (empty)

Saved receipt: `/tmp/aozr/evidence/scratch-sockets.txt` (embedded before scratch cleanup).

```text

```

### Real-state paths newer than marker

Saved receipt: `/tmp/aozr/evidence/live-state-changes-precleanup.txt` (embedded before scratch cleanup).

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/deliveries
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/.agent-conversations
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2253
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-86
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-87
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

## Appendix — independent harness and scratch runners

These are the executed final harness sources. Early harness-builder mistakes (primitive traversal and shared mutable input fixtures) were corrected before the completed differential results; failed attempts were not treated as successful comparisons. No implementer harness source was available or reused. Paths below were scratch-only and are removed after review.

### Main differential harness

`/tmp/aozr/harness.mjs`

```javascript
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root='/tmp/aozr';
const modules=await Promise.all(['base','tip'].map(async side=>({
  c: await import(pathToFileURL(`${root}/${side}/packages/core/dist/config.js`)),
  f: await import(pathToFileURL(`${root}/${side}/packages/core/dist/feedback-tools.js`)),
  z: await import(pathToFileURL(`${root}/${side}/packages/core/node_modules/zod/index.js`)),
})));
export function canon(v) {
  if (v===undefined) return ['undefined'];
  if (typeof v==='number') return ['number',Number.isNaN(v)?'NaN':Object.is(v,-0)?'-0':String(v)];
  if (typeof v==='bigint') return ['bigint',String(v)];
  if (typeof v==='symbol') return ['symbol',Symbol.keyFor(v)??v.description];
  if (typeof v==='function') return ['function',v.name];
  if (v===null||typeof v!=='object') return [typeof v,v];
  if (v instanceof Date) return ['date',v.toISOString()];
  return [Array.isArray(v)?'array':'object',...(Array.isArray(v)?[v.length]:[]),Reflect.ownKeys(v).filter(k=>Object.prototype.propertyIsEnumerable.call(v,k)).map(k=>[canon(k),canon(v[k])])];
}
function copy(v) {
  if (!v||typeof v!=='object') return v;
  if(v instanceof Date) return new Date(v);
  const out=Array.isArray(v)?new Array(v.length):Object.create(Object.getPrototypeOf(v));
  for(const k of Reflect.ownKeys(v)) if(k!=='length') Object.defineProperty(out,k,{...Object.getOwnPropertyDescriptor(v,k),value:copy(v[k])});
  return out;
}
const min=()=>({projects:{app:{repo:'org/app',path:'/repos/app'}}});
const feedback=()=>({title:' a\t b ',body:' B ',evidence:[' e\n f '],session:'s',source:'agent',confidence:0.5});
const remove=Symbol('remove');
function put(o,path,v) {const keys=path.split('.');let p=o; for(let i=0;i<keys.length-1;i++){const k=keys[i];if(!Object.hasOwn(p,k)||!p[k]||typeof p[k]!=='object') Object.defineProperty(p,k,{value:/^\d+$/.test(keys[i+1])?[]:{},writable:true,configurable:true,enumerable:true});p=p[k];} const last=keys.at(-1);if(v===remove) delete p[last];else Object.defineProperty(p,last,{value:copy(v),writable:true,configurable:true,enumerable:true});return o;}
const cases=[];
const add=(id,input)=>cases.push({id,input});
add('minimal',min());add('no-projects',{projects:{}});
for(const x of [undefined,null,0,'',[],true,new Date('2024-01-01')]) add(`root:${cases.length}`,x);
const generic=[remove,undefined,null,false,true,'','x',0,-0,1,-1,0.5,Infinity,-Infinity,NaN,Number.MAX_SAFE_INTEGER+1,1e300,{},[],['x'],{x:1}];
const projectFields='name repo path defaultBranch sessionPrefix runtime agent workspace tracker scm symlinks postCreate agentConfig orchestrator worker reactions agentRules agentRulesFile orchestratorRules orchestratorWorkspaceMode orchestratorSessionStrategy opencodeIssueSessionStrategy decomposer'.split(' ');
const fields=['port','terminalPort','directTerminalPort','readyThresholdMs','defaults','plugins','projects','notifiers','notificationRouting','reactions',...projectFields.map(k=>`projects.app.${k}`)];
for(const k of ['runtime','agent','workspace','notifiers','orchestrator','worker']) fields.push(`defaults.${k}`);
for(const r of ['orchestrator','worker']) fields.push(`defaults.${r}.agent`);
for(const r of ['agentConfig','orchestrator.agentConfig','worker.agentConfig']) for(const k of ['permissions','model','orchestratorModel','opencodeSessionId']) fields.push(`projects.app.${r}.${k}`);
for(const r of ['orchestrator','worker']) fields.push(`projects.app.${r}.agent`);
for(const r of ['tracker','scm']) for(const k of ['plugin','package','path']) fields.push(`projects.app.${r}.${k}`);
for(const k of ['plugin','package','path']) fields.push(`notifiers.desktop.${k}`);
fields.push('projects.app.scm.webhook');
for(const k of ['enabled','path','secretEnvVar','signatureHeader','eventHeader','deliveryHeader','maxBodyBytes']) fields.push(`projects.app.scm.webhook.${k}`);
for(const k of ['enabled','maxDepth','model','requireApproval']) fields.push(`projects.app.decomposer.${k}`);
for(const k of ['auto','action','message','priority','retries','escalateAfter','threshold','includeSummary']) for(const prefix of ['reactions.custom','projects.app.reactions.custom']) fields.push(`${prefix}.${k}`);
for(const k of ['name','source','package','version','path','enabled']) fields.push(`plugins.0.${k}`);
fields.push('notificationRouting.urgent','defaults.notifiers.0','projects.app.symlinks.0','projects.app.postCreate.0');
function baseline(path) {const o=min();if(path.startsWith('plugins.')) o.plugins=[{name:'p',source:'local',path:'./p'}];if(path.includes('.scm'))o.projects.app.scm={plugin:'github'};if(path.includes('.tracker'))o.projects.app.tracker={plugin:'github'};if(path.startsWith('notifiers.'))o.notifiers={desktop:{plugin:'desktop'}};return o;}
for(const path of fields) for(const [i,v] of generic.entries()) add(`field:${path}:${i}`,put(baseline(path),path,v));
const enumPaths={
 'projects.app.agentConfig.permissions':['permissionless','default','auto-edit','suggest','skip'],
 'projects.app.orchestrator.agentConfig.permissions':['permissionless','default','auto-edit','suggest','skip'],
 'projects.app.worker.agentConfig.permissions':['permissionless','default','auto-edit','suggest','skip'],
 'projects.app.orchestratorWorkspaceMode':['isolated','project'],
 'projects.app.orchestratorSessionStrategy':['reuse','delete','ignore','delete-new','ignore-new','kill-previous'],
 'projects.app.opencodeIssueSessionStrategy':['reuse','delete','ignore'],
 'reactions.custom.action':['send-to-agent','notify','auto-merge'],
 'reactions.custom.priority':['urgent','action','warning','info'],
 'projects.app.reactions.custom.action':['send-to-agent','notify','auto-merge'],
 'projects.app.reactions.custom.priority':['urgent','action','warning','info'],
};
for(const [p,vs] of Object.entries(enumPaths))for(const v of vs)add(`enum:${p}:${v}`,put(min(),p,v));
const objects=['','defaults','defaults.orchestrator','defaults.worker','projects.app','projects.app.tracker','projects.app.scm','projects.app.scm.webhook','projects.app.agentConfig','projects.app.orchestrator','projects.app.worker','projects.app.orchestrator.agentConfig','projects.app.worker.agentConfig','projects.app.decomposer','reactions.custom','projects.app.reactions.custom','notifiers.desktop','plugins.0'];
for(const path of objects) for(const [i,value] of [undefined,null,Infinity,NaN,-0,{},[],true,'x'].entries()) {
 const o=baseline(path);const p=path?put(o,path,(()=>{const b=path==='plugins.0'?{name:'p',source:'local',path:'./p'}:path.endsWith('.tracker')||path.endsWith('.scm')||path==='notifiers.desktop'?{plugin:'builtin'}:path==='projects.app'?{repo:'org/app',path:'/repos/app'}:{};b.unknown=value;return b;})()):{...o,unknown:value};
 add(`unknown:${path||'root'}:${i}`,p);
}
for(const path of ['projects','reactions','notifiers','notificationRouting','projects.app.reactions']) {
 for(const key of ['custom','constructor','toString','__proto__','bad.key','a/b','','0','10','2']) {
  const value=path==='projects'?{repo:'org/r',path:'/repos/r'}:path==='notifiers'?{plugin:'desktop'}:path==='notificationRouting'?['desktop']:{};
  add(`record-key:${path}:${key}`,put(path==='projects'?{projects:{}}:min(),path,Object.defineProperty({},key,{value,writable:true,configurable:true,enumerable:true})));
 }
 const value=path==='projects'?{repo:'org/inherited',path:'/repos/inherited'}:path==='notifiers'?{plugin:'desktop'}:path==='notificationRouting'?['desktop']:{message:'inherited'};
 add(`record-inherited:${path}`,put(min(),path,Object.create({inherited:value})));
 class Entries {constructor(){this.custom=value;}}
 add(`record-class:${path}`,put(min(),path,new Entries()));
 add(`record-symbol:${path}`,put(min(),path,{[Symbol.for('extra')]:value}));
 add(`record-null-proto:${path}`,put(min(),path,Object.assign(Object.create(null),{custom:value})));
}
for(const path of ['projects.app.agentConfig','projects.app.tracker','projects.app.scm','notifiers.desktop'])add(`loose-inherited:${path}`,put(min(),path,Object.assign(Object.create({extra:'inherited'}),{plugin:'p'})));
for(const p of ['port','terminalPort','directTerminalPort','readyThresholdMs','projects.app.decomposer.maxDepth','projects.app.scm.webhook.maxBodyBytes','reactions.custom.retries','reactions.custom.escalateAfter','projects.app.reactions.custom.retries','projects.app.reactions.custom.escalateAfter']) for(const x of [-Number.MAX_VALUE,Number.MIN_VALUE,2**53+2,1e-7,5.00001,-0,Infinity,-Infinity]) add(`numeric:${p}:${String(x)}`,put(baseline(p),p,x));
let state=0x46661;const rand=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
const pick=vs=>vs[Math.floor(rand()*vs.length)];
for(let i=0;i<5000;i++) {const o=min();for(let j=0,n=1+Math.floor(rand()*7);j<n;j++)put(o,pick(fields),pick(generic));add(`random:${i}`,o);}
const validChoices={port:[undefined,-0,3.5,Infinity,-Infinity],readyThresholdMs:[0,Infinity,1],defaults:[{},undefined,{orchestrator:{},worker:{agent:'codex'},notifiers:[]}],plugins:[[],[{name:'p',source:'local',path:'~/p'}]],'projects.app.agentConfig':[{},undefined,{permissions:'skip',extra:'x'}],'projects.app.orchestrator':[{},undefined,{agentConfig:{permissions:'skip',extra:'x'}}],'projects.app.worker':[{},undefined,{agentConfig:{}}],'projects.app.decomposer':[{},undefined,{maxDepth:4.5}], 'projects.app.reactions':[{custom:{}},{custom:{auto:undefined,action:undefined,message:'x'}},{custom:{retries:Infinity,escalateAfter:-Infinity}}],reactions:[{custom:{}},{custom:{message:'x',auto:false,action:'send-to-agent'}},{custom:{escalateAfter:Infinity,retries:-0}}],'projects.app.scm':[{plugin:'github',extra:undefined},{plugin:'github',webhook:{}},{plugin:'github',webhook:{maxBodyBytes:2**53+2}}],notifiers:[{desk:{plugin:'desktop'}},{}]};
for(let i=0;i<5000;i++){const o=min();for(const [p,vs] of Object.entries(validChoices))if(rand()<.6)put(o,p,pick(vs));add(`valid-random:${i}`,o);}
function result(fn,input){try{return {ok:true,value:canon(fn(copy(input)))}}catch(e){return {ok:false,issues:e.issues?.map(x=>({path:x.path,code:x.code,message:x.message})),name:e.name};}}
let bothOk=0,bothBad=0;const mismatches=[];const results=[];
for(const {id,input} of cases) {const r=modules.map(m=>result(m.c.validateConfig,input));results.push({id,base:r[0].ok,tip:r[1].ok});if(r[0].ok&&r[1].ok)bothOk++;if(!r[0].ok&&!r[1].ok)bothBad++;if(r[0].ok!==r[1].ok||(r[0].ok&&JSON.stringify(r[0].value)!==JSON.stringify(r[1].value)))mismatches.push({id,base:r[0],tip:r[1]});}
assert(results.length>0);assert(results.some(r=>r.id==='minimal'&&r.base&&r.tip));
writeFileSync(`${root}/evidence/config-mismatches.json`,JSON.stringify(mismatches,null,2));
writeFileSync(`${root}/evidence/config-results.json`,JSON.stringify(results));
console.log(JSON.stringify({configCases:cases.length,bothAccepted:bothOk,bothRejected:bothBad,mismatches:mismatches.length,sentinel:results.find(r=>r.id==='minimal'),mismatchIds:mismatches.slice(0,50).map(r=>r.id)},null,2));
const fCases=[{id:'feedback-valid',input:feedback()}];for(const p of ['title','body','session','source','confidence','evidence','evidence.0'])for(const [i,v]of [...generic,' \t\r\n ','a\u00a0b'].entries())fCases.push({id:`feedback:${p}:${i}`,input:put(feedback(),p,v)});
fCases.push({id:'feedback-extra',input:{...feedback(),extra:undefined}});
for(let i=0;i<1000;i++){const o=feedback();for(let j=0,n=1+Math.floor(rand()*4);j<n;j++)put(o,pick(['title','body','session','source','confidence','evidence']),pick(generic));fCases.push({id:`feedback-random:${i}`,input:o});}
const fDiff=[];let fok=0,fbad=0;for(const tool of ['bug_report','improvement_suggestion']) for(const {id,input}of fCases){const r=modules.map(m=>result(x=>m.f.validateFeedbackToolInput(tool,x),input));if(r.every(x=>x.ok))fok++;if(r.every(x=>!x.ok))fbad++;if(r[0].ok!==r[1].ok||(r[0].ok&&JSON.stringify(r[0].value)!==JSON.stringify(r[1].value)))fDiff.push({tool,id,...r});}
assert(fCases.some(x=>x.id==='feedback-valid'));console.log(JSON.stringify({feedbackCases:2*fCases.length,bothAccepted:fok,bothRejected:fbad,mismatches:fDiff.length,sentinel:'feedback-valid accepted for both tools on both sides'}));
const dates=new Set(['2024-02-29T12:34Z','2026-10-24T12:34:56+9999','2026-10-24T12:34:56-99:99']);
for(const y of ['0000','1900','2000','2024','2025','2026'])for(const md of ['01-01','02-28','02-29','02-30','04-31','12-31','13-01'])for(const t of ['00:00','12:34','23:59:59','12:34:56.123','24:00:00','12:60:00','12:34:60','12:34:56.'])for(const z of ['Z','+00:00','-0200','+23:59','+24:00','-99:99','+02','','z'])dates.add(`${y}-${md}T${t}${z}`);
for(let i=0;i<2000;i++) {const s=`${pick(['2024-02-29','2026-10-24','2025-02-29'])}T${pick(['01:23','23:59:59','.','12:34:56.00001'])}${pick(['Z','+0200','+99:99','-24:00','+00'])}`;dates.add(s);}
const reportDir=`${root}/feedback-forms`;mkdirSync(reportDir,{recursive:true});let i=0;const dateById={};
for(const createdAt of dates){const id=`report_form_${i++}`;dateById[id]=createdAt;writeFileSync(`${reportDir}/${id}.kv`,['version=1',`id=${id}`,'tool=bug_report',`createdAt=${createdAt}`,`dedupeKey=${'0f'.repeat(8)}`,'title=t','body=b','session=s','source=agent','confidence=0.5','evidence.0=e',''].join('\n'));}
const lists=modules.map(m=>new m.f.FeedbackReportStore(reportDir).list().map(x=>x.id).sort());
for(const list of lists){assert(list.length>0);assert(list.includes('report_form_0'));}
const dDiff=[...new Set([...lists[0],...lists[1]])].filter(id=>lists[0].includes(id)!==lists[1].includes(id));
const z3=modules[0].z.z.string().datetime({offset:true});const expected=Object.entries(dateById).filter(([,s])=>z3.safeParse(s).success).map(([id])=>id).sort();assert(expected.length>0&&expected.includes('report_form_0'));assert.deepEqual(lists[0],expected);assert.deepEqual(lists[1],expected);
console.log(JSON.stringify({createdAtCases:dates.size,baseAccepted:lists[0].length,tipAccepted:lists[1].length,mismatches:dDiff.length,sentinel:'report_form_0 = 2024-02-29T12:34Z'}));
for(const file of ['primary.yaml','skills.yaml','nexus.yaml']) {const path=`${root}/configs/${file}`;const r=modules.map(m=>result(()=>m.c.loadConfig(path)));assert(r.every(x=>x.ok));assert(r.every(x=>x.value.length>1));const a=modules[0].c.loadConfig(path),b=modules[1].c.loadConfig(path);const paths=[];function walk(x,p){if(x&&typeof x==='object'){for(const k of Object.keys(x))walk(x[k],p?`${p}.${k}`:k);}else paths.push(p);}walk(a,'');assert(paths.includes('defaults.agent'));console.log(JSON.stringify({liveConfig:file,baseKeys:paths.length,tipKeys:(()=>{const before=paths.length;walk(b,'');return paths.length-before;})(),sentinel:'defaults.agent',equal:JSON.stringify(r[0].value)===JSON.stringify(r[1].value),keyPaths:paths.slice(0,paths.length/2)}));}
```

### Targeted raw-object/YAML/error probes

`/tmp/aozr/targeted.mjs`

```javascript
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root='/tmp/aozr';
const config=await Promise.all(['base','upgrade'].map(s=>import(pathToFileURL(`${root}/${s}/packages/core/dist/config.js`))));
const yaml=await import(`${root}/base/packages/core/node_modules/yaml/dist/index.js`);
const p=()=>({repo:'org/app',path:'/repos/app'});
function describe(f,x,select){try {const v=f(x);return {ok:true,...select(v)};}catch(e){return {ok:false,issues:e.issues?.map(x=>({path:x.path,code:x.code,message:x.message})),name:e.name};}}
function probe(name,input,select){console.log(JSON.stringify({name,base:describe(config[0].validateConfig,input(),select),tip:describe(config[1].validateConfig,input(),select)},(_key,value)=>typeof value==='symbol'?String(value):value));}
probe('loose undefined key',()=>({projects:{app:{...p(),agentConfig:{extra:undefined}}}}),v=>({keys:Object.keys(v.projects.app.agentConfig),extraIn:'extra' in v.projects.app.agentConfig}));
probe('record inherited key',()=>({projects:{},notificationRouting:Object.create({urgent:['desktop']})}),v=>({keys:Object.keys(v.notificationRouting)}));
probe('record symbol key',()=>({projects:{},notificationRouting:{[Symbol.for('extra')]:['desktop']}}),v=>({keys:Reflect.ownKeys(v.notificationRouting)}));
class Routes { urgent=['desktop']; }
probe('record class instance',()=>({projects:{},notificationRouting:new Routes()}),v=>({keys:Object.keys(v.notificationRouting)}));
const protoDiff=[];
for(const [name,prefix] of [['projects','projects:\n  __proto__: '],['reactions','projects: {}\nreactions:\n  __proto__: '],['notifiers','projects: {}\nnotifiers:\n  __proto__: '],['notificationRouting','projects: {}\nnotificationRouting:\n  __proto__: '],['project-reactions','projects:\n  app:\n    repo: org/app\n    path: /repos/app\n    reactions:\n      __proto__: ']]){
 for(const invalid of ['null','false','"x"','[]']){
 const path=`${root}/configs/proto-${name}-${invalid.replace(/[^a-z]/g,'')}.yaml`;writeFileSync(path,`${prefix}${invalid}\n`);
 const values=config.map(c=>{try {c.loadConfig(path);return {ok:true};}catch(e){return {ok:false,issues:e.issues?.map(x=>({path:x.path,code:x.code,message:x.message}))};}});
 if(values[0].ok!==values[1].ok) protoDiff.push({name,invalid,base:values[0],tip:values[1]});
 }
}
console.log(JSON.stringify({yamlProtoComparisons:20,mismatches:protoDiff.length,examples:protoDiff}));
const z3=(await import(`${root}/base/packages/core/node_modules/zod/index.js`)).z;
const z4=(await import(`${root}/upgrade/packages/core/node_modules/zod/index.js`)).z;
const f3=await import(`${root}/base/packages/core/dist/feedback-tools.js`),f4=await import(`${root}/upgrade/packages/core/dist/feedback-tools.js`);
const errCases={missing:()=>({projects:{app:{path:'/p'}}}),enum:()=>({projects:{app:{...p(),orchestratorWorkspaceMode:'x'}}}),key:()=>({projects:{'bad.key':{}}}),wrongNumber:()=>({projects:{},port:'3000'}),fraction:()=>({projects:{app:{...p(),scm:{plugin:'github',webhook:{maxBodyBytes:1.5}}}}}),bounds:()=>({projects:{app:{...p(),decomposer:{maxDepth:6}}}}),ready:()=>({projects:{},readyThresholdMs:-1}),nested:()=>({projects:{app:{...p(),scm:{webhook:{maxBodyBytes:0}}}}}),pluginAborted:()=>({projects:{app:{...p(),tracker:{path:1}}}})};
errCases.roleLiteral=()=>({projects:{app:{...p(),orchestrator:{agentConfig:{permissions:'x'}}}}});errCases.nullRecord=()=>({projects:null});errCases.numberNaN=()=>({projects:{},port:NaN});errCases.readyNegInfinity=()=>({projects:{},readyThresholdMs:-Infinity});errCases.decomposerInfinity=()=>({projects:{app:{...p(),decomposer:{maxDepth:Infinity}}}});
const errors=[];for(const [name,f]of Object.entries(errCases)){errors.push({name,...Object.fromEntries(config.map((c,i)=>{try{c.validateConfig(f());return [i?'tip':'base',{accepted:true}];}catch(e){return [i?'tip':'base',{issues:e.issues,message:e.message,hasErrors:'errors'in e,isZod:e instanceof (i?z4:z3).ZodError,flatten:e.flatten(),format:e.format()}];}}))});}
for(const input of [{title:' ',body:'b',evidence:[],session:'s',source:'agent',confidence:Infinity},{title:'t',body:'b',evidence:['e'],session:'s',source:'agent',confidence:0.5,extra:1,other:2}])errors.push({feedback:true,...Object.fromEntries([f3,f4].map((m,i)=>{try{m.validateFeedbackToolInput('bug_report',input);}catch(e){return [i?'tip':'base',{issues:e.issues,message:e.message}];}}))});
writeFileSync(`${root}/evidence/errors.json`,JSON.stringify(errors,null,2));
console.log(JSON.stringify({errorCases:errors.length,customNested:errors.find(x=>x.name==='nested'),customAborted:errors.find(x=>x.name==='pluginAborted')}));
```

### Additional regex/YAML/persisted-metadata probes

`/tmp/aozr/extra-probes.mjs`

```javascript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root='/tmp/aozr';
const c=await Promise.all(['base','upgrade'].map(s=>import(`file://${root}/${s}/packages/core/dist/config.js`)));
const z3=await import(`file://${root}/base/packages/core/node_modules/zod/v3/types.js`);
const src=readFileSync(`${root}/evidence/feedback-tip.ts`,'utf8');
const date=(src.match(/const ZOD3_DATE =([\s\S]*?);/)[1].match(/"(?:[^"\\]|\\.)*"/g)).map(x=>JSON.parse(x)).join('');
const time=JSON.parse(src.match(/const ZOD3_TIME = ("(?:[^"\\]|\\.)*");/)[1]);
const actual=new RegExp(`^${date}T${time}(Z|([+-]\\d{2}:?\\d{2}))$`);
const expected=z3.datetimeRegex({offset:true});
assert(actual.source.length>0&&expected.source.length>0);assert(actual.test('2024-02-29T01:23Z')&&expected.test('2024-02-29T01:23Z'));assert.equal(actual.source,expected.source);
console.log(JSON.stringify({createdAtRegexSourceEqual:true,basePatternLength:expected.source.length,tipPatternLength:actual.source.length,sentinel:'2024-02-29T01:23Z'}));
const yamlCases=['projects: {}','port: .inf\nterminalPort: -.inf\ndirectTerminalPort: 1e999\nreadyThresholdMs: .inf\nprojects: {}','port: .nan\nprojects: {}','readyThresholdMs: -1\nprojects: {}','port: -0\nprojects: {}','projects:\n  app:\n    repo: org/app\n    path: ~/app\n    decomposer: {}','defaults: {}\nprojects: {}','defaults:\n  notifiers: []\nprojects: {}','projects:\n  app:\n    repo: org/app\n    path: /app\n    agentConfig:\n      permissions: skip','reactions:\n  z:\n    message: first\n    action: send-to-agent\n    auto: false\nprojects: {}'];
const encode=v=>JSON.stringify(v,(_k,x)=>x===undefined?['undefined']:typeof x==='number'?['number',Object.is(x,-0)?'-0':String(x)]:x);
let accepted=0,rejected=0;for(const [i,yaml]of yamlCases.entries()){const path=`${root}/configs/synthetic-${i}.yaml`;writeFileSync(path,yaml+'\n');const r=c.map(m=>{try{return {ok:true,value:encode(m.loadConfig(path))};}catch{return {ok:false};}});assert.deepEqual(r[0],r[1]);if(r[0].ok)accepted++;else rejected++;}
console.log(JSON.stringify({syntheticYamlCases:yamlCases.length,bothAccepted:accepted,bothRejected:rejected,mismatches:0,sentinel:'projects: {}'}));
const f=await Promise.all(['base','upgrade'].map(s=>import(`file://${root}/${s}/packages/core/dist/feedback-tools.js`)));
const dir=`${root}/feedback-metadata`;mkdirSync(dir,{recursive:true});let n=0;const forms={id:['report_ok','bad','','report_','report_a.b'],tool:['bug_report','improvement_suggestion','x',''],dedupeKey:['0f'.repeat(8),'ABCDEF0123456789','short',''],confidence:['0','-0','1','0.5','NaN','Infinity','-Infinity','2','-1']};
for(const [field,values]of Object.entries(forms))for(const value of values){const row={id:`report_meta_${n}`,tool:'bug_report',createdAt:'2024-02-29T01:23Z',dedupeKey:'0f'.repeat(8),title:'t',body:'b',session:'s',source:'agent',confidence:'0.5','evidence.0':'e',[field]:value};writeFileSync(`${dir}/report_meta_${n++}.kv`,Object.entries(row).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');}
const lists=f.map(m=>new m.FeedbackReportStore(dir).list().map(x=>encode(x)).sort());assert(lists[0].length>0&&lists[1].length>0);assert(lists.every(list=>list.some(x=>x.includes('report_ok'))));assert.deepEqual(lists[0],lists[1]);console.log(JSON.stringify({persistedMetadataCases:n,baseAccepted:lists[0].length,tipAccepted:lists[1].length,mismatches:0,sentinel:'report_ok'}));
```

### Dependency comparison

`/tmp/aozr/dependency-probe.mjs`

```javascript
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parse } from './base/packages/core/node_modules/yaml/dist/index.js';
const locks=['base','tip'].map(s=>parse(readFileSync(`/tmp/aozr/${s}/pnpm-lock.yaml`,'utf8')));
for(const [i,d]of locks.entries()) {assert(d.packages['yaml@2.8.3']);const version=i?'4.6.7':'3.25.76';assert(d.packages[`zod@${version}`]);delete d.importers['packages/core'].dependencies.zod;delete d.packages[`zod@${version}`];delete d.snapshots[`zod@${version}`];}
assert.deepEqual(locks[0],locks[1]);
console.log(JSON.stringify({nonZodLockDataEqual:true,basePackages:Object.keys(locks[0].packages).length,tipPackages:Object.keys(locks[1].packages).length,sentinel:'yaml@2.8.3'}));
const versions=['base','tip','upgrade'].map(s=>({copy:s,installed:JSON.parse(readFileSync(`/tmp/aozr/${s}/packages/core/node_modules/zod/package.json`,'utf8')).version}));
console.log(JSON.stringify(versions));
```

### Strict type compatibility probe

`/tmp/aozr/types-probe-corrected.ts`

```typescript
import type { z } from 'zod';
import { BugReportSchema, ImprovementSuggestionSchema, type BugReportInput, type ImprovementSuggestionInput, type FeedbackToolInput, type FeedbackToolContract } from './dist/feedback-tools.js';
import type { OrchestratorConfig } from './dist/types.js';
import { validateConfig, loadConfig } from './dist/config.js';
type Shape={ title:string; body:string; evidence:string[]; session:string; source:string; confidence:number };
type Equal<A,B>=[A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Check<T extends true>=T;
export type Checks=[Check<Equal<BugReportInput,Shape>>,Check<Equal<ImprovementSuggestionInput,Shape>>,Check<Equal<FeedbackToolInput,Shape>>,Check<Equal<z.input<typeof BugReportSchema>,Shape>>,Check<Equal<z.input<typeof ImprovementSuggestionSchema>,Shape>>,Check<Equal<ReturnType<typeof validateConfig>,OrchestratorConfig>>,Check<Equal<ReturnType<typeof loadConfig>,OrchestratorConfig>>,Check<Equal<FeedbackToolContract['schema'],typeof BugReportSchema>>];
```

### Mutation generator

`/tmp/aozr/mutations.py`

```python
from pathlib import Path
root=Path('/tmp/aozr');c=(root/'evidence/config-tip.ts').read_text();f=(root/'evidence/feedback-tip.ts').read_text()
mutations={
 'undo-agent-prefault':(c.replace('AgentSpecificConfigSchema.prefault({})','AgentSpecificConfigSchema.default({} as z.output<typeof AgentSpecificConfigSchema>)'),f),
 'undo-defaults-prefault':(c.replace('DefaultPluginsSchema.prefault({})','DefaultPluginsSchema.default({} as z.output<typeof DefaultPluginsSchema>)'),f),
 'undo-decomposer':(c.replace('decomposer: DecomposerConfigSchema.optional(),','decomposer: DecomposerConfigSchema.default({enabled:false,maxDepth:3,model:"claude-sonnet-4-20250514",requireApproval:true}).optional(),'),f),
 'undo-reaction-override':(c.replace('const ReactionOverrideSchema = ReactionFieldsSchema.partial();','const ReactionOverrideSchema = ReactionConfigSchema.partial();'),f),
 'undo-number-union':(c.replace('const NumberSchema = z.union([z.number(), InfiniteNumberSchema], { error: firstOptionMessage });','const NumberSchema = z.number();'),f),
 'undo-ready-infinity':(c.replace('.union([z.number().nonnegative(), z.literal(Infinity)], { error: firstOptionMessage })','.number().nonnegative()'),f),
 'undo-escalate-infinity':(c.replace('z.union([z.number(), InfiniteNumberSchema, z.string()])','z.union([z.number(), z.string()])'),f),
 'undo-large-integer':(c.replace('.refine(Number.isInteger, "Expected integer, received float")','.int()'),f),
 'undo-createdAt':(c,f.replace('.regex(new RegExp(`^${ZOD3_DATE}T${ZOD3_TIME}(Z|([+-]\\\\d{2}:?\\\\d{2}))$`), "Invalid datetime")','.datetime({ offset: true })')),
 'wrong-prefault-add-undefined':(c.replace('AgentSpecificConfigSchema.prefault({})','AgentSpecificConfigSchema.prefault({ model: undefined })'),f),
 'wrong-reaction-strip-undefined':(c.replace('const ReactionOverrideSchema = ReactionFieldsSchema.partial();','const ReactionOverrideSchema = ReactionFieldsSchema.partial().transform((value) => { for (const key of Object.keys(value) as (keyof typeof value)[]) { if (value[key] === undefined) delete value[key]; } return value; });'),f),
 'wrong-ready-negative':(c.replace('z.number().nonnegative(), z.literal(Infinity)','z.number(), z.literal(Infinity)'),f),
}
for name,(config,feedback) in mutations.items():
 assert config!=c or feedback!=f,name
 d=root/'mutations'/name;d.mkdir(parents=True,exist_ok=True);(d/'config.ts').write_text(config);(d/'feedback-tools.ts').write_text(feedback)
(root/'mutations/names.txt').write_text('\n'.join(mutations)+'\n')
```

### Mutation runner

`/tmp/aozr/run-mutations.sh`

```bash
#!/bin/bash
set -u
cd /tmp/aozr/tip
while IFS= read -r name; do
 cp "/tmp/aozr/mutations/$name/config.ts" packages/core/src/config.ts
 cp "/tmp/aozr/mutations/$name/feedback-tools.ts" packages/core/src/feedback-tools.ts
 pnpm --filter @aoagents/ao-core build > "/tmp/aozr/evidence/mutation-$name-build.log" 2>&1
 build_result=$?
 if [ "$build_result" -eq 0 ]; then
  pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/config-zod-pins.test.ts src/__tests__/feedback-tools.test.ts --reporter=json --outputFile="/tmp/aozr/evidence/mutation-$name.json" > "/tmp/aozr/evidence/mutation-$name-test.log" 2>&1
  printf '%s build=%s test=%s\n' "$name" "$build_result" "$?"
 else
  printf '%s build=%s test=not-run\n' "$name" "$build_result"
 fi
done < /tmp/aozr/mutations/names.txt
cp /tmp/aozr/evidence/config-tip.ts packages/core/src/config.ts
cp /tmp/aozr/evidence/feedback-tip.ts packages/core/src/feedback-tools.ts
pnpm --filter @aoagents/ao-core build > /tmp/aozr/evidence/mutations-restored-build.log 2>&1
printf 'restore build=%s\n' "$?"
```

### Wrong-mutation behavior probe

`/tmp/aozr/wrong-probe.mjs`

```javascript
import assert from 'node:assert/strict';
const base=await import('file:///tmp/aozr/base/packages/core/dist/config.js');
const tip=await import('file:///tmp/aozr/tip/packages/core/dist/config.js');
const min=()=>({projects:{app:{repo:'org/app',path:'/repos/app'}}});
const name=process.argv[2];
const run=(m)=>{
 if(name==='wrong-prefault-add-undefined')return Object.keys(m.validateConfig(min()).projects.app.agentConfig);
 if(name==='wrong-reaction-strip-undefined'){const o=min();o.projects.app.reactions={custom:{auto:undefined}};return Object.keys(m.validateConfig(o).projects.app.reactions.custom);}
 try {m.validateConfig({...min(),readyThresholdMs:-1});return 'accepted';}catch{return 'rejected';}
};
const a=run(base),b=run(tip);assert.notDeepEqual(a,b);console.log(JSON.stringify({name,base:a,mutant:b}));
```

### Resident module-cache probe

`/tmp/aozr/resident-probe.mjs`

```javascript
import { cpSync, unlinkSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const url='file:///tmp/aozr/resident/dist/config.js';
const first=await import(url);
const code=m=>{try{m.validateConfig({projects:{'bad.key':{repo:'org/a',path:'/a'}}});}catch(e){return e.issues[0].code;}};
const initial=code(first);
cpSync('/tmp/aozr/upgrade/packages/core/dist','/tmp/aozr/resident/dist',{recursive:true});
unlinkSync('/tmp/aozr/resident/node_modules/zod');symlinkSync('/tmp/aozr/upgrade/packages/core/node_modules/zod','/tmp/aozr/resident/node_modules/zod');
const after=await import(url);
const fresh=execFileSync('node',['--input-type=module','-e',`const m=await import('${url}');try{m.validateConfig({projects:{'bad.key':{repo:'org/a',path:'/a'}}});}catch(e){console.log(e.issues[0].code);}`],{encoding:'utf8'}).trim();
assert.equal(first,after);assert.equal(initial,'invalid_string');assert.equal(code(after),initial);assert.equal(fresh,'invalid_key');
console.log(JSON.stringify({initialCode:initial,sameModuleAfterRebuild:first===after,residentAfterRebuild:code(after),newProcessAfterRebuild:fresh}));
```

### Offline upgrade runner

`/tmp/aozr/run-upgrade.sh`

```bash
#!/bin/bash
set -u
cd /tmp/aozr/upgrade
run() { local label="$1"; shift; "$@" > "/tmp/aozr/evidence/upgrade-${label}.log" 2>&1; local result=$?; printf '%s exit=%s\n' "$label" "$result"; if [ "$result" -ne 0 ]; then tail -15 "/tmp/aozr/evidence/upgrade-${label}.log"; exit "$result"; fi; }
run base-install pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3
run base-build pnpm build
find node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort > /tmp/aozr/evidence/upgrade-base-packages.txt
cp /tmp/aozr/tip/packages/core/package.json packages/core/package.json
cp /tmp/aozr/tip/pnpm-lock.yaml pnpm-lock.yaml
cp /tmp/aozr/evidence/config-tip.ts packages/core/src/config.ts
cp /tmp/aozr/evidence/feedback-tip.ts packages/core/src/feedback-tools.ts
run tip-install pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3
run tip-build pnpm build
find node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort > /tmp/aozr/evidence/upgrade-tip-packages.txt
run help node packages/cli/dist/index.js --help
run why pnpm --filter @aoagents/ao-core why zod
printf '%s\n' 'projects: {}' > /tmp/aozr/configs/cli.yaml
AO_CONFIG_PATH=/tmp/aozr/configs/cli.yaml node packages/cli/dist/index.js session ls > /tmp/aozr/evidence/upgrade-cli-config.log 2>&1
printf 'cli-config exit=%s\n' "$?"
```

### Same-ID red runner

`/tmp/aozr/run-red.sh`

```bash
#!/bin/bash
set -u
for side in base tip; do
 cd "/tmp/aozr/$side"
 SAME_ID_DEFECTS=red pnpm -r --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree --no-bail exec vitest run same-id --reporter=verbose > "/tmp/aozr/evidence/$side-red.log" 2>&1
 printf '%s red exit=%s\n' "$side" "$?"
done
```

### Invocation and isolation

Each script/test was launched with this environment pattern (the store flag is used for installs only):

```bash
env -i HOME=/tmp/aozr/home TMPDIR=/tmp/aozr/tmp PATH=/tmp/aozr/bin \
  CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true node /tmp/aozr/harness.mjs
```

The pnpm link targets the cached 9.15.4 node_modules/pnpm/bin/pnpm.cjs. The initial bad pnpm link was corrected before install; no missing offline package blocked either archive. The curated bin directory supplies ordinary shell/test utilities and flock, and points git to /usr/bin/git. The gh stub rejects every command except --version and auth status. The tmux shim is:

```sh
#!/bin/sh
exec /usr/bin/env -u TMUX /usr/bin/tmux -L aozr-tests "$@"
```

Tests with their own -S socket retain it. There is no agent/herdr binary or npm/npx on the inherited scratch PATH. The live upgrade copy's CLI is invoked through node directly, never through the real global ao.

## Final cleanup receipts

- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/deliveries` — concurrent Nexus fleet/session bookkeeping; exact writer PID not captured.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions` — concurrent Nexus fleet/session bookkeeping; exact writer PID not captured.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator` — concurrent Nexus fleet/session bookkeeping; exact writer PID not captured.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/.agent-conversations` — concurrent Nexus fleet/session bookkeeping; exact writer PID not captured.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2253` — concurrent Nexus fleet/session bookkeeping; exact writer PID not captured.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions` — AO managed session directory updates; exact writer PID not captured.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-86` — upgrade worker ao-86 managed-session bookkeeping; not a reviewer write.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-87` — this managed review session's automatic AO bookkeeping; no reviewer-issued command wrote the record directly; exact manager PID not captured.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator` — AO orchestrator managed-session bookkeeping; not a reviewer write.

The exact attribution above is by live managed surface, not a measured process trace. No real-state record was edited to change or restore metadata during this review.

Saved final receipt `review-self-check.txt`:

```text
single verdict line; all six finding IDs; evidence and harness appendices; balanced fences; no ANSI escapes
review file: /home/taisung/.worktrees/agent-orchestrator/ao-87/development/reviews/zod_466_upgrade_code_review_r1_sol61.md
```

Saved final receipt `tracked-diff-check.exit`:

```text
tracked diff exit=0
```

Saved final receipt `tmux-final.log`:

```text
no server running on /tmp/tmux-44402/aozr-tests
```

Saved final receipt `tmux-final.exit`:

```text
private tmux exit=1
```

Saved final receipt `socket-final.log`:

```text
private stale socket removed
```

Saved final receipt `process-final.log`:

```text
remaining scratch processes: 0
```

Saved final receipt `ao-bin-final.exit`:

```text
final ao-bin comparison exit=0
```

Scratch tree `/tmp/aozr`, marker `/tmp/aozr-marker`, and the private stale tmux socket were removed. Final shell absence checks succeeded. The review and status report are the only reviewer-created worktree deliverables; tracked source files and HEAD are unchanged.
