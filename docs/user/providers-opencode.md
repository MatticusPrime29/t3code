# OpenCode and OpenRouter

T3 Code can use OpenRouter through its OpenCode provider. OpenCode is the agent harness: it runs
the coding session and exposes the models available from the OpenRouter account you connect.

## Set Up OpenRouter

1. [Install OpenCode](https://opencode.ai/docs/).
2. On the machine running the T3 Code server, start OpenCode's provider login:

   ```bash
   opencode auth login --provider openrouter
   ```

3. Paste your OpenRouter API key into OpenCode's local prompt. Do not put the key in T3 Code's
   settings file or commit it to a repository.
4. Open **Settings**, find the OpenCode provider card, and turn it on. If `opencode` is not on the
   server process's `PATH`, set **Binary path** to the full path of the OpenCode executable.
5. Open the model picker and select a model from the OpenRouter provider listed under OpenCode.

OpenCode stores the credential on the server machine. T3 Code launches the OpenCode process with
that machine's environment and reads its provider/model inventory, so the API key does not pass
through the browser or T3 Code settings.

## Check the Connection

List OpenCode's authenticated providers:

```bash
opencode auth list
```

List the OpenRouter models visible to OpenCode:

```bash
opencode models openrouter
```

If OpenRouter is authenticated but no models appear in T3 Code, restart the T3 Code server after
enabling OpenCode. Also confirm the login command and T3 Code are running as the same operating
system user and use the same OpenCode configuration directories.

## Multiple OpenRouter Accounts

Create a separate OpenCode provider instance in T3 Code for each account. Give every instance its
own OpenCode configuration and credential directories through the instance's environment variables,
then authenticate OpenRouter once inside each environment. This keeps credentials and model
inventories isolated while preserving one model picker.
