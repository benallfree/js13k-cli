## js13k CLI

Command‑line tools for building and serving js13kGames projects.

### Quick start

```bash
npx js13k --help
```

Run a specific command:

```bash
npx js13k <command>
```

### Commands

- **dev**: Run the dev server with js13k defaults.

  ```bash
  npx js13k dev
  ```

- **build**: Build the project with js13k defaults (outputs to `dist/`).

  ```bash
  npx js13k build
  ```

- **preview**: Serve the built `dist/` directory and print the local URL.

  ```bash
  npx js13k preview
  ```

- **relay**: Start a minimal WebSocket relay at `/parties/relay/<room>`.

  ```bash
  npx js13k relay
  ```

  - **PORT**: Set the port via the `PORT` env var (default: `4321`).
  - Clients connect to: `ws://localhost:<PORT>/parties/relay/<room>`

### Help

- Global help: `npx js13k --help`
- Command help: `npx js13k <command> --help`
