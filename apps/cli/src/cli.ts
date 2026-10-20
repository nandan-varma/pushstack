import pkg from "../package.json" with { type: "json" };
import { apiCommand } from "./commands/api";
import { authCommand } from "./commands/auth";
import { issueCommand } from "./commands/issue";
import { prCommand } from "./commands/pr";
import { repoCommand } from "./commands/repo";
import { CliError, type Io } from "./io";

export const VERSION = pkg.version;

const HELP = `Work with PushStack from the command line, modeled on gh.

USAGE
  pst <command> <subcommand> [flags]

COMMANDS
  auth:   Authenticate pst with a PushStack host (login --with-token, status, logout, token)
  repo:   Manage repositories (view, list, create)
  issue:  Manage issues (list, view, create, close, reopen)
  pr:     Manage pull requests (list, view, create, merge, close, reopen, checkout)
  api:    Make an authenticated request to the REST API (/api/v3)

FLAGS
  --hostname   The PushStack host (default git.nandan.fyi, or PST_HOST)
  --version    Show pst version

ENVIRONMENT
  PST_TOKEN    A personal access token; overrides the stored one
  PST_HOST     The default host
  PST_REPO     The default OWNER/REPO
`;

export async function run(argv: string[], io: Io): Promise<number> {
	try {
		const [command, ...rest] = argv;
		switch (command) {
			case undefined:
			case "help":
			case "-h":
			case "--help":
				io.stdout(HELP);
				return 0;
			case "--version":
			case "version":
				io.stdout(`pst version ${VERSION}\n`);
				return 0;
			case "auth":
				await authCommand(io, rest);
				return 0;
			case "issue":
				await issueCommand(io, rest);
				return 0;
			case "pr":
				await prCommand(io, rest);
				return 0;
			case "repo":
				await repoCommand(io, rest);
				return 0;
			case "api":
				await apiCommand(io, rest);
				return 0;
			default:
				throw new CliError(
					`unknown command "${command}" for "pst"\n\nRun 'pst --help' for usage.`,
				);
		}
	} catch (error) {
		if (error instanceof CliError) {
			if (error.message) io.stderr(`pst: ${error.message}\n`);
			return error.exitCode;
		}
		io.stderr(`pst: ${(error as Error).message}\n`);
		return 1;
	}
}
