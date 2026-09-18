# headreel

[![npm](https://img.shields.io/npm/v/headreel)](https://www.npmjs.com/package/headreel)
[![CI](https://github.com/arifszn/headreel/actions/workflows/ci.yml/badge.svg)](https://github.com/arifszn/headreel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An animated banner for your GitHub profile, made from your own GitHub activity.

![Contribution City banner](https://raw.githubusercontent.com/arifszn/headreel/main/docs/samples/contribution-city.gif)

headreel turns your contributions into a looping GIF. A GitHub Action makes a new banner every day and saves it in your profile repository. Your profile README shows the banner.

- **One file to set up.** Add one workflow file and one line in your README.
- **Always current.** The workflow updates the banner on a schedule.
- **Works on light and dark themes.** Each style has its own background.
- **Runs on your computer too.** Use `npx headreel` on macOS, Windows, or Linux.

## Set up the banner

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

More styles are in progress.

## Run it on your computer

You can make a banner without a workflow. You need [Node.js](https://nodejs.org) 22 (22.22.2 or later), 24 (24.15.0 or later), or 26 and later.

```bash
npx headreel --style contribution-city --user octocat --out banner.gif
```

headreel needs a GitHub token to read your contributions. It looks for a token in this order:

1. The `--token` option.
2. The `GITHUB_TOKEN` environment variable.
3. The [GitHub CLI](https://cli.github.com), if you are logged in with `gh auth login`.

Add your tagline, website, and style options:

```bash
npx headreel --style contribution-city --user octocat \
  --tagline "Open source maintainer" \
  --website https://example.com \
  --option beacons=5
```

You can also keep your settings in a JSON file:

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
