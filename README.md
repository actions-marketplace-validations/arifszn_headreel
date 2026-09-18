# headreel

[![npm](https://img.shields.io/npm/v/headreel)](https://www.npmjs.com/package/headreel)
[![CI](https://github.com/arifszn/headreel/actions/workflows/ci.yml/badge.svg)](https://github.com/arifszn/headreel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An animated banner for your GitHub profile, made from your own GitHub activity.

![Contribution City banner](https://raw.githubusercontent.com/arifszn/headreel/main/docs/samples/contribution-city.gif)

headreel turns your contributions into a looping GIF. You can use it in two ways:

- **One command on your computer.** Run `npx headreel` and get your banner. You do not install or set up anything. It works on macOS, Windows, and Linux.
- **A GitHub Action that keeps it current.** Add one workflow file, and your banner updates every day by itself.

Every style works on both light and dark GitHub themes.

## Make your banner now

Run this command. Replace `octocat` with your GitHub username.

```bash
npx headreel --style contribution-city --user octocat
```

The command saves your banner as `headreel.gif` in the current folder. The first run downloads headreel. After that, a banner takes a few seconds.

Add your tagline and website:

```bash
npx headreel --style contribution-city --user octocat \
  --tagline "Open source maintainer" \
  --website https://example.com
```

You need [Node.js](https://nodejs.org) 22 (22.22.2 or later), 24 (24.15.0 or later), or 26 and later. You also need a GitHub token. If you use the [GitHub CLI](https://cli.github.com), log in with `gh auth login`, and headreel finds the token. For other ways, see [Command options](#command-options).

To put the banner on your profile, add `headreel.gif` to your profile repository. Then add this line to its `README.md`:

```markdown
![My GitHub activity](headreel.gif)
```

## Keep it updated with the GitHub Action

A banner that you make on your computer does not change. The Action makes a new banner every day.

Your profile repository has the same name as your username, for example `octocat/octocat`. Do these steps in that repository.

1. Create the file `.github/workflows/headreel.yml` with this content:

   ```yaml
   name: headreel

   on:
     schedule:
       - cron: '0 0 * * *' # every day at 00:00 UTC
     workflow_dispatch: # lets you run it from the Actions tab

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
             tagline: Senior Software Engineer · Distributed Systems
             website: https://example.com
   ```

2. Open the **Actions** tab of the repository. Select **headreel**, then select **Run workflow**.
3. Wait for the run to finish. The workflow adds `headreel.gif` to the repository.
4. Add this line to your `README.md`:

   ```markdown
   ![My GitHub activity](headreel.gif)
   ```

> [!NOTE]
> The workflow makes a commit only when the banner changes. Your contribution count changes most days, so expect about one commit each day.

## Action inputs

| Input            | Default                         | Description                                                        |
| ---------------- | ------------------------------- | ------------------------------------------------------------------ |
| `style`          | (required)                      | The banner style. See [Styles](#styles).                           |
| `username`       | repository owner                | The GitHub user to show.                                           |
| `tagline`        | empty                           | One line under your name. Empty means no tagline.                  |
| `website`        | empty                           | Your website, for example `https://example.com`. Empty means none. |
| `handle`         | empty                           | A handle, for styles that show one.                                |
| `options`        | empty                           | Style settings, one `key: value` on each line.                     |
| `output`         | `headreel.gif`                  | The path of the banner in your repository.                         |
| `commit_to`      | the checked-out branch          | The branch that gets the banner.                                   |
| `commit_message` | `chore: update headreel banner` | The commit message for each update.                                |
| `token`          | `github.token`                  | The token that reads your contribution data.                       |

Your name comes from your GitHub profile. If your profile has no name, the banner shows your username.

## Styles

### Contribution City

`style: contribution-city`

Each day of the last 12 months is one building. A taller building means more contributions on that day. A light beam moves across the city, and beacons glow on your busiest days.

The banner shows your name, your tagline, your total contributions, and your website.

| Option    | Default | Description                                        |
| --------- | ------- | -------------------------------------------------- |
| `beacons` | `8`     | The number of busiest days with a beacon, 0 to 10. |

Example:

```yaml
- uses: arifszn/headreel@v1
  with:
    style: contribution-city
    options: |
      beacons: 5
```

## Command options

| Option                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `--style <id>`         | The banner style (required). See [Styles](#styles).   |
| `--user <login>`       | Your GitHub username (required).                      |
| `--out <file>`         | Where to save the GIF. The default is `headreel.gif`. |
| `--tagline <text>`     | One line under your name.                             |
| `--website <url>`      | Your website.                                         |
| `--handle <text>`      | A handle, for styles that show one.                   |
| `--option <key=value>` | A style setting. Use it again for each setting.       |
| `--config <file>`      | A JSON file with your settings.                       |
| `--token <token>`      | A GitHub token. See the token order below.            |

headreel needs a GitHub token to read your contributions. It looks for a token in this order:

1. The `--token` option.
2. The `GITHUB_TOKEN` environment variable.
3. The [GitHub CLI](https://cli.github.com), if you are logged in with `gh auth login`.

You can keep your settings in a JSON file:

```json
{
  "style": "contribution-city",
  "user": "octocat",
  "tagline": "Open source maintainer",
  "website": "https://example.com",
  "options": { "beacons": 5 }
}
```

```bash
npx headreel --config headreel.json
```

Options on the command line replace the values in the file. To see all options, run `npx headreel --help`.

## Troubleshooting

**The workflow fails with "Permission denied" or a 403 error.**
Make sure that the workflow file contains `permissions: contents: write`.

**The workflow fails with "Could not resolve to a User".**
Check the `username` input. It must be a GitHub username.

**The command fails with "No GitHub token found".**
Log in with `gh auth login`, or set the `GITHUB_TOKEN` environment variable.
