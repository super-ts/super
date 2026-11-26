//! Zed extension for `.super` files: declares the "Super" language and starts its language
//! server (`packages/lang-server` in the Super repository, or the installed `super-language-server` package).

use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

/// Where to look for the server, relative to the root of the open project.
const SERVER_SCRIPTS: &[&str] = &[
    "node_modules/super-language-server/src/server.ts",
    "packages/lang-server/src/server.ts",
];

struct SuperExtension;

impl zed::Extension for SuperExtension {
    fn new() -> Self {
        SuperExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let env = worktree.shell_env();

        // A binary given in the settings (`lsp.super-language-server.binary`) takes precedence.
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree).ok();
        if let Some(binary) = settings.and_then(|s| s.binary) {
            if let Some(path) = binary.path {
                return Ok(zed::Command {
                    command: path,
                    args: binary.arguments.unwrap_or_default(),
                    env,
                });
            }
        }

        let script = SERVER_SCRIPTS
            .iter()
            .find(|path| worktree.read_text_file(path).is_ok())
            .ok_or_else(|| {
                ".super server not found: install the super-language-server package, or open the Super repository"
                    .to_string()
            })?;
        let server = format!("{}/{}", worktree.root_path(), script);

        // The server is written in TypeScript and run as is: it needs a Node that strips types.
        // The one on the project's PATH first (Node 23.6 or later does it on its own), otherwise Zed's.
        let (node, mut args) = match worktree.which("node") {
            Some(node) => (node, vec![]),
            None => (zed::node_binary_path()?, vec!["--experimental-strip-types".to_string()]),
        };
        args.push(server);
        args.push("--stdio".to_string());
        Ok(zed::Command { command: node, args, env })
    }
}

zed::register_extension!(SuperExtension);
