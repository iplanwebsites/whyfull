# scriptc Compatibility Plan

## Goal
Compile yful to a standalone native binary (~320KB) using [scriptc](https://scriptc.dev/) — no Node/Bun runtime required.

## Current Status
89% of statements compile statically. Three blockers prevent full compilation.

## Blockers

| # | Type | Location | Fix | Effort |
|---|------|----------|-----|--------|
| 1 | `Set<string>` | `scan.ts`, `size.ts` | Replace with `Map<string, boolean>` | Low |
| 2 | `Date \| null` | `ChildEntry.atime` | Use `number` (epoch ms), -1 for null | Low |
| 3 | `ScannedTarget[]` | Core API | See below | High |

## The ScannedTarget Problem

scriptc compiles arrays of primitives and simple records, but not arrays of interfaces with:
- Optional fields (`files?: number`)
- Nullable fields (`bytes: number | null`)
- Nested complex types (`children: ChildEntry[]`)

`ScannedTarget` has all three:

```typescript
interface ScannedTarget {
  id: string
  label: string
  path: string | null          // nullable
  bytes: number | null         // nullable
  files?: number               // optional
  denied?: boolean             // optional
  partial?: boolean            // optional
  children: ChildEntry[]       // nested array
  // ... 10 more fields
}
```

### Options

**A) Flatten to parallel arrays**
```typescript
// Instead of: targets: ScannedTarget[]
targetIds: string[]
targetLabels: string[]
targetBytes: number[]      // -1 = null
targetFiles: number[]      // -1 = missing
targetChildren: string[][] // serialized
```
- Breaks the public API
- Harder to consume as a library
- Report JSON becomes unwieldy

**B) Use `Map<string, unknown>` per target**
```typescript
targets: Map<string, unknown>[]
```
- Loses type safety
- Runtime field access instead of static

**C) Keep Node/Bun, skip scriptc**
- Current approach works fine
- 96KB bundle + runtime vs 320KB standalone
- Users already have Node if they're devs

## Recommendation

Fix blockers 1 and 2 (trivial, improves JSON serialization anyway).

For blocker 3: unless standalone binary is a hard requirement, the API degradation isn't worth it. Ship via `npx yful` or bundle with Bun (`bun build --compile`).

## Quick Wins (independent of decision)

```bash
# Blocker 1: Set → Map
-const seen = new Set<string>()
+const seen = new Map<string, true>()

# Blocker 2: Date → epoch
-atime: Date | null
+atimeMs: number  // -1 for null
```

These changes also make the report fully JSON-round-trippable (Date objects don't survive `JSON.parse(JSON.stringify())`).
