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
             publish_mode: branch
             tagline: Open source maintainer
             website: https://example.com
   ```

3. Run the workflow once from the **Actions** tab. It adds `headreel.gif` to the `headreel` branch.
4. Add the image line to your `README.md`. The workflow run page shows it, ready to copy. It looks like this:

   ```markdown
   ![My GitHub activity](https://raw.githubusercontent.com/octocat/octocat/headreel/headreel.gif)
   ```

The workflow updates the banner only when it changes. After an update, the new banner can take up to 5 minutes to show. See [Settings](#settings) for all inputs.

### Keep your repository small

The setup above uses `publish_mode: branch`. The banner lives on its own `headreel` branch, and each update replaces the old banner, so your repository does not grow.

If you remove `publish_mode: branch`, each update adds a new commit to your main branch. Old banners stay in your history, and each one is a few MB.

## Command

Run this command. Replace `octocat` with your GitHub username.

```bash
npx headreel --style contribution-city --user octocat --tagline "Open source maintainer" --website https://example.com
```

The command saves `headreel.gif` in the current folder. Add the file to your profile repository, and add `![My GitHub activity](headreel.gif)` to its `README.md`.

You need:

- A GitHub token. headreel uses `--token`, then `GITHUB_TOKEN`, then your [GitHub CLI](https://cli.github.com) login (`gh auth login`).

## Settings

The Action and the command use the same settings.

| Action input     | Command flag           | Default                         | Description                                                                                                          |
| ---------------- | ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `style`          | `--style`              | (required)                      | The banner style. See [Styles](#styles).                                                                             |
| `username`       | `--user`               | repository owner                | The GitHub user to show. The command requires it.                                                                    |
| `tagline`        | `--tagline`            | empty                           | One line under your name.                                                                                            |
| `website`        | `--website`            | empty                           | Your website.                                                                                                        |
| `handle`         | `--handle`             | empty                           | A handle, for styles that show one.                                                                                  |
| `options`        | `--option <key=value>` | empty                           | Style options. Action: one `key: value` on each line. Command: repeat the flag, for example `--option accent=green`. |
| `output`         | `--out`                | `headreel.gif`                  | The path of the banner.                                                                                              |
| `token`          | `--token`              | `github.token`                  | The token that reads your GitHub data.                                                                               |
| `publish_mode`   | -                      | `commit`                        | `commit` adds a commit on every update. `branch` keeps one commit on its own branch, replaced on every update.       |
| `commit_to`      | -                      | checked-out branch / `headreel` | The branch that gets the banner. The default is `headreel` in `branch` mode.                                         |
| `commit_message` | -                      | `chore: update headreel banner` | The commit message.                                                                                                  |
| -                | `--config <file>`      | -                               | A JSON file with these settings. Flags replace its values.                                                           |

Empty settings do not show on the banner. Your name comes from your GitHub profile. If your profile has no name, the banner shows your username.

## Styles

Set the style with `style: <name>` in the Action, or `--style <name>` in the command. Set an option with `options: 'accent: green'` in the Action, or `--option accent=green` in the command. For more than one option in the Action, put each on its own line.

### Contribution City

`contribution-city`: each day of the last 12 months is one building. A taller building means more contributions. Beacons glow on your busiest days.

![Contribution City banner](https://raw.githubusercontent.com/arifszn/headreel/main/docs/samples/contribution-city.gif)

| Option   | Default | Description                                                                                   |
| -------- | ------- | --------------------------------------------------------------------------------------------- |
| `accent` | `cyan`  | Color of the roofs, windows, lights and links: `cyan`, `cobalt`, `green`, `violet` or `pink`. |

### Highlights Reel

`highlights-reel`: a few profile facts, each on its own card, filmed by one camera. The camera travels between the cards, pushes into your busiest week, and ends on a wide shot of the whole reel.

![Highlights Reel banner](https://raw.githubusercontent.com/arifszn/headreel/main/docs/samples/highlights-reel.gif)

| Option   | Default  | Description                                                                            |
| -------- | -------- | -------------------------------------------------------------------------------------- |
| `theme`  | `light`  | `light` or `dark`. Use `dark` if your profile is mostly viewed in GitHub dark mode.    |
| `accent` | `cobalt` | Color of the bars, numbers and links: `cobalt`, `green`, `violet`, `orange` or `pink`. |

### Repo Galaxy

`repo-galaxy`: your most starred repositories orbit a sun. A bigger planet has more stars, and its color is the repository's main language. Repositories you pushed to recently orbit closer to the sun.

![Repo Galaxy banner](https://raw.githubusercontent.com/arifszn/headreel/main/docs/samples/repo-galaxy.gif)

| Option          | Default | Description                                                           |
| --------------- | ------- | --------------------------------------------------------------------- |
| `max_repos`     | `20`    | The number of repositories to show, 5 to 30.                          |
| `include_forks` | `false` | Show forked repositories too.                                         |
| `labels`        | `top3`  | `top3` names the three most starred repositories. `none` hides names. |

## Troubleshooting

| Problem                          | Fix                                                      |
| -------------------------------- | -------------------------------------------------------- |
| "Permission denied" or 403 error | Add `permissions: contents: write` to the workflow file. |
| "Could not resolve to a User"    | Set `username` to a valid GitHub username.               |
| "No GitHub token found"          | Run `gh auth login`, or set `GITHUB_TOKEN`.              |

## Support

If headreel is useful to you, please [star the repository](https://github.com/arifszn/headreel). It helps other people find it.

## License

[MIT License](./LICENSE).
