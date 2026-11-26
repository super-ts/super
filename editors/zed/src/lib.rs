//! Zed extension for `.super` files: declares the "Super" language and starts its language server,
//! the `@super-ts/language-server` npm package.
//!
//! The server is installed from npm at the version of `@super-ts/lang` in the open project, so the
//! editor and the compiler agree; a project without Super gets the latest version. A binary set in
//! the settings (`lsp.super-language-server.binary`) takes precedence: the Super repository uses it to
//! run the server from its sources.

use zed_extension_api::{
    self as zed, serde_json, settings::LspSettings, LanguageServerId, Result,
};

/// The npm package of the server, and its entry point once installed.
const SERVER_PACKAGE: &str = "@super-ts/language-server";
const SERVER_PATH: &str = "node_modules/@super-ts/language-server/dist/server.js";

/// The compiler package whose version the server follows, read in the open project.
const LANG_MANIFEST: &str = "node_modules/@super-ts/lang/package.json";

struct SuperExtension {
    /// The server version installed during this session, to avoid asking npm again.
    installed: Option<String>,
}

impl SuperExtension {
    /// The version of `@super-ts/lang` installed in the project, if any.
    fn project_version(worktree: &zed::Worktree) -> Option<String> {
        let manifest = worktree.read_text_file(LANG_MANIFEST).ok()?;
        let json: serde_json::Value = serde_json::from_str(&manifest).ok()?;
        json.get("version")?.as_str().map(str::to_string)
    }

    /// Installs the server at the wanted version if needed, and returns the path of its entry point.
    fn server_path(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<String> {
        let wanted = match Self::project_version(worktree) {
            Some(version) => version,
            None => {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::CheckingForUpdate,
                );
                zed::npm_package_latest_version(SERVER_PACKAGE)?
            }
        };

        let present = std::path::Path::new(SERVER_PATH).exists();
        let current = match &self.installed {
            Some(version) => Some(version.clone()),
            None => zed::npm_package_installed_version(SERVER_PACKAGE)?,
        };
        if !present || current.as_deref() != Some(wanted.as_str()) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Err(error) = zed::npm_install_package(SERVER_PACKAGE, &wanted) {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::Failed(error.clone()),
                );
                return Err(format!("could not install {SERVER_PACKAGE}@{wanted}: {error}"));
            }
        }
        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::None,
        );
        self.installed = Some(wanted);

        // npm installs into the extension's working directory: Node needs an absolute path.
        let directory = std::env::current_dir().map_err(|error| error.to_string())?;
        Ok(directory.join(SERVER_PATH).to_string_lossy().into_owned())
    }
}

impl zed::Extension for SuperExtension {
    fn new() -> Self {
        SuperExtension { installed: None }
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

        let server = self.server_path(language_server_id, worktree)?;
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server, "--stdio".to_string()],
            env,
        })
    }
}

zed::register_extension!(SuperExtension);
