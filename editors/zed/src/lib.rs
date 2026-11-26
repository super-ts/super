//! Extension Zed des fichiers `.super` : déclare le langage « Super » et lance son serveur de
//! langage (`packages/lang-server` du dépôt Super, ou le paquet `super-language-server` installé).

use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

/// Où chercher le serveur, relativement à la racine du projet ouvert.
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

        // Un binaire donné dans les réglages (`lsp.super-language-server.binary`) l'emporte.
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
                "serveur .super introuvable : installe le paquet super-language-server, ou ouvre le dépôt Super"
                    .to_string()
            })?;
        let server = format!("{}/{}", worktree.root_path(), script);

        // Le serveur est écrit en TypeScript, lancé tel quel : il faut un Node qui retire les types.
        // Celui du PATH du projet d'abord (Node 23.6 ou plus le fait seul), sinon celui de Zed.
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
