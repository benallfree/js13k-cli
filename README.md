## js13k CLI

A tiny CLI for js13kGames development using Bun + Vite defaults.

### Install

```bash
bun install
```

### Build (for local development of the CLI)

```bash
bun run build
```

### Usage

From source (recommended while developing):

```bash
bun src/index.ts --help
```

After building:

```bash
bun dist/index.js --help
```

### Commands

- **dev**: Run the Vite dev server with js13k defaults.

  ```bash
  bun src/index.ts dev
  # or: js13k dev
  ```

- **build**: Build the project with js13k Vite defaults. Outputs to `dist/`.

  ```bash
  bun src/index.ts build
  # or: js13k build
  ```

- **preview**: Serve the built `dist/` directory.

  ```bash
  bun src/index.ts preview
  # or: js13k preview
  ```

  Prints the local preview URL on start.

- **relay**: Start a minimal WebSocket relay at `/parties/relay/<room>`.

  ```bash
  bun src/index.ts relay
  # or: js13k relay
  ```

  - **PORT**: Set the listen port via `PORT` (default: `4321`).
  - Connect clients to: `ws://localhost:<PORT>/parties/relay/<room>`

### Notes

- The CLI uses js13k Vite defaults via `js13k-vite-plugins`.
- Bun is required. Prefer `bun` over Node/npm/yarn.
