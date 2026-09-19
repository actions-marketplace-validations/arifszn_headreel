# Contributing to headreel

Thanks for your interest in improving headreel. This guide covers setup, development, and how to send changes.

## Setup

You need Node.js 22 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
```

## Development

| Command          | What it does                |
| ---------------- | --------------------------- |
| `pnpm dev`       | Runs the CLI locally.       |
| `pnpm build`     | Builds to `dist/`.          |
| `pnpm typecheck` | Type checks the source.     |
| `pnpm lint`      | Lints with oxlint.          |
| `pnpm format`    | Formats with Prettier.      |
| `pnpm test`      | Runs the tests with Vitest. |

To try the CLI with your own data:

```bash
pnpm dev --style contribution-city --user octocat
```

## Sending changes

1. Open an [issue](https://github.com/arifszn/headreel/issues) first for a bug or a new feature, so we can agree on the approach.
2. Fork the repository and create a branch for your change.
3. Make your change. Add or update tests when the change is code.
4. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`. All must pass.
5. Open a pull request with a short description of what changed and why.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org), for example `feat: add beacons option` or `fix: handle users without a name`.

## Adding a style

A style is a folder in `src/styles/`. Look at an existing style, such as `contribution-city`, for the shape: the sketch that draws the banner, its options, and an entry in `src/styles/index.ts`.

Open an issue with your idea before you build, so we can agree on how it looks and which options it takes.

## Reporting bugs

Open an [issue](https://github.com/arifszn/headreel/issues) with:

- The command or workflow file you used.
- What you expected, and what happened instead.
- The full error output.