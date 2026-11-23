# Fox Plains shared code

Fox Plains is retired: it is no longer built into a page or listed on the site, and `#module-maplestreet` opens Life Sim instead. This folder keeps only the code other parts of the site import, so it keeps its old name.

- `shared/`: renderer-free rules. Life Sim's world Durable Object (`FoxLakeWorld` in `src/server/maplestreet-world.ts`) runs `WorldServer.ts` and `RoomLogic.ts`; the admin item and vehicle editors and their API routes use the catalog, custom item and custom vehicle code.
- `src/net/`, `src/core/Storage.ts`, `src/core/Input.ts`, `src/core/DevMode.ts`: client transport and helpers used by Life Sim and Kestrel County.
- `src/avatar/Gait.ts`, `src/avatar/RigData.ts`: used by Kestrel County through Fox Plains 2's avatar.
- `tests/`: tests for the shared code, run by `scripts/maplestreet-tests.mjs` as part of `pnpm test`.

Check that nothing outside this folder imports a file before deleting it.
