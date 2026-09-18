# headreel

[![npm](https://img.shields.io/npm/v/headreel)](https://www.npmjs.com/package/headreel)
[![GitHub Marketplace](https://img.shields.io/badge/marketplace-headreel-blue?logo=github)](https://github.com/marketplace/actions/headreel)
[![CI](https://github.com/arifszn/headreel/actions/workflows/ci.yml/badge.svg)](https://github.com/arifszn/headreel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An animated banner for your GitHub profile, made from your GitHub activity.

![Contribution City banner](https://raw.githubusercontent.com/arifszn/headreel/main/docs/samples/contribution-city.gif)

Pick one way to make your banner:

- [GitHub Action](#github-action): updates the banner every day. No setup on your computer.
- [Command](#command): makes the banner once on your computer.

## GitHub Action

The Action is on the [GitHub Marketplace](https://github.com/marketplace/actions/headreel).

1. Open your profile repository. This is the public repository with the same name as your username, for example `octocat/octocat`.
2. Add `.github/workflows/headreel.yml`:

   ```yaml
   name: headreel

   on:
     schedule:
       - cron: '0 0 * * *' # every day at 00:00 UTC
     workflow_dispatch:

   permissions:
     contents: write

   jobs:
     banner:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
         - uses: arifszn/headreel@v1
           with:
             style: contribution-city
             tagline: Open source maintainer
             website: https://example.com
   ```

3. Run the workflow once from the **Actions** tab. It adds `headreel.gif` to the repository.
4. Add this line to your `README.md`:

   ```markdown
   ![My GitHub activity](headreel.gif)
   ```

The workflow commits the banner only when it changes. See [Settings](#settings) for all inputs.

## Command

Run this command. Replace `octocat` with your GitHub username.

```bash
npx headreel --style contribution-city --user octocat --tagline "Open source maintainer" --website https://example.com
```

The command saves `headreel.gif` in the current folder. Add the file to your profile repository, and add the image line from step 4 above to its `README.md`.

You need:

- A GitHub token. headreel uses `--token`, then `GITHUB_TOKEN`, then your [GitHub CLI](https://cli.github.com) login (`gh auth login`).

## Settings

The Action and the command use the same settings.

| Action input     | Command flag           | Default                         | Description                                                                                                       |
| ---------------- | ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `style`          | `--style`              | (required)                      | The banner style. See [Styles](#styles).                                                                          |
| `username`       | `--user`               | repository owner                | The GitHub user to show. The command requires it.                                                                 |
| `tagline`        | `--tagline`            | empty                           | One line under your name.                                                                                         |
| `website`        | `--website`            | empty                           | Your website.                                                                                                     |
| `handle`         | `--handle`             | empty                           | A handle, for styles that show one.                                                                               |
| `options`        | `--option <key=value>` | empty                           | Style options. Action: one `key: value` on each line. Command: repeat the flag, for example `--option beacons=5`. |
| `output`         | `--out`                | `headreel.gif`                  | The path of the banner.                                                                                           |
| `token`          | `--token`              | `github.token`                  | The token that reads your contribution data.                                                                      |
| `commit_to`      | -                      | the checked-out branch          | The branch that gets the banner.                                                                                  |
| `commit_message` | -                      | `chore: update headreel banner` | The commit message.                                                                                               |
| -                | `--config <file>`      | -                               | A JSON file with these settings. Flags replace its values.                                                        |

Empty settings do not show on the banner. Your name comes from your GitHub profile. If your profile has no name, the banner shows your username.

## Styles

### Contribution City

`contribution-city`: each day of the last 12 months is one building. A taller building means more contributions. Beacons glow on your busiest days.

| Option    | Default | Description                                        |
| --------- | ------- | -------------------------------------------------- |
| `beacons` | `8`     | The number of busiest days with a beacon, 0 to 10. |

Set an option with `options: 'beacons: 5'` in the Action, or `--option beacons=5` in the command.

## Troubleshooting

| Problem                          | Fix                                                      |
| -------------------------------- | -------------------------------------------------------- |
| "Permission denied" or 403 error | Add `permissions: contents: write` to the workflow file. |
| "Could not resolve to a User"    | Set `username` to a valid GitHub username.               |
| "No GitHub token found"          | Run `gh auth login`, or set `GITHUB_TOKEN`.              |
