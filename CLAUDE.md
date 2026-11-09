@AGENTS.md

## Working on your own

The owner only writes prompts. Finish every task end to end without asking, unless a step can't be undone and could reasonably go either way.

- Work on a branch named `claude/<short-topic>` from the latest `origin/main`. Every change reaches `main` through a pull request.
- Before opening or updating a pull request, run the checks the `modules` workflow runs (`pnpm assets:check`, `pnpm build`, `pnpm test`) for the areas you touched, and fix every error and failing test you find, including ones that were already there if they block the check.
- Merge conflicts: merge `origin/main` into the branch, resolve every conflict keeping both sides' intent, rebuild and retest. Never leave conflict markers.
- Open the pull request with `gh api` (REST). GraphQL is not available from cloud sessions, so `gh pr list/merge/view` fail there; use `gh api repos/garrdetto/thelibrary/pulls...` instead.
- Merging: wait for the `modules` check on the pull request's head commit (`gh api repos/garrdetto/thelibrary/commits/<sha>/check-runs`). If it fails, read the job log (`gh api repos/garrdetto/thelibrary/actions/jobs/<id>/logs`), fix, push, and wait again. Once it passes, squash-merge with `gh api -X PUT repos/garrdetto/thelibrary/pulls/<n>/merge -f merge_method=squash`. No branch rule on `main` requires the check, so auto-merge would merge before the check finishes; don't rely on it.
- A failed `Workers Builds: thelibrary` check on a pull request is Cloudflare's preview build and doesn't block merging when `modules` passes. After merging, check that `Workers Builds: thelibrary` on the new `main` commit succeeds; if it fails, investigate and open a fix.
- Before starting, list open pull requests. Don't push to a branch another session updated in the last hour; build on `main` instead and mention the overlap.
- Finish by reporting what changed, the pull request link and whether it merged and deployed.
