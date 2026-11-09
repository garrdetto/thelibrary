# Run site changes on your laptop

With **Run on my laptop** ticked in Admin → Site changes, requests run on your own computer instead of GitHub's machines. It's still the same `site-change.yml` workflow and the same pull requests, and the panel works the same way. If GitHub reports the laptop offline, the request runs on GitHub instead, and the panel tells you so.

The laptop runs a GitHub Actions self-hosted runner inside WSL (Ubuntu), so the job gets the same Linux tools it has on GitHub. It only connects out to GitHub, so no ports are opened on your network.

## One-time setup (Windows)

1. **Install WSL** in an administrator PowerShell, then restart: `wsl --install -d Ubuntu`. Open *Ubuntu* from the Start menu and create a user.
2. **Protect the laptop from strangers' pull requests.** The repository is public. Go to GitHub → Settings → Actions → General → *Approval for running fork pull request workflows from contributors* and choose **Require approval for all external contributors**. Without that, someone could open a pull request whose workflow targets your laptop.
3. **Get a registration token.** Go to GitHub → Settings → Actions → Runners → **New self-hosted runner** and copy the value after `--token`. It's valid for one hour.
4. **In Ubuntu**, run:
   ```sh
   git clone https://github.com/garrdetto/thelibrary ~/thelibrary
   bash ~/thelibrary/scripts/laptop-runner/setup.sh PASTE_TOKEN_HERE
   ```
5. **Start it automatically** by running this in Windows PowerShell (not as administrator) from the folder where you cloned the repo, or point `-File` at a copy:
   ```powershell
   powershell -ExecutionPolicy Bypass -File \\wsl$\Ubuntu\home\<you>\thelibrary\scripts\laptop-runner\install-startup.ps1 -KeepAwake
   ```
   To run it by hand instead, run `~/actions-runner/run.sh` in Ubuntu and leave the window open.
6. **Optional:** so the panel can show whether the laptop is online and fall back to GitHub when it isn't, give the `SITE_CHANGES_GITHUB_TOKEN` Cloudflare secret's token **Administration: Read** too. If it doesn't have that, laptop requests are sent anyway. If the laptop is off, they wait in the queue until it comes back.

The runner is registered as `msi-laptop`. To use another name, set `SITE_CHANGES_RUNNER_LABEL` before running `setup.sh`, as a GitHub repository variable, and as a Cloudflare variable.

On the laptop, Claude uses the Claude account you sign in to there. `setup.sh` installs Claude Code; run `claude`, then `/login`. It does not use the `ANTHROPIC_API_KEY` secret, so laptop requests count toward your Claude plan's usage, not your API credits. Requests on GitHub still use the API key. That same login also lets you start Remote Control sessions on the laptop from the Claude app (`claude remote-control`). Keep the laptop plugged in and awake while requests run.

## 3D models (Meshy + Blender)

Laptop runs are the best place for 3D requests ("add a rowboat to the Angler dock", "a park ranger who waves"): Claude generates the model with Meshy, and Blender on the laptop grounds, sizes and slims it before it goes into the site. GitHub's machines have no Blender, so there the model arrives raw and Claude sizes it in code. `setup.sh` installs Blender; on a laptop that's already set up, run:

```sh
cd ~/thelibrary && git pull && bash scripts/laptop-runner/install-blender.sh
```

Also add your Meshy API key as the `MESHY_API_KEY` repository secret on GitHub (Settings → Secrets and variables → Actions). Details: `docs/MESHY-PIPELINE.md`.
