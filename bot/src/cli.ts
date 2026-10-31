import { init } from "./commands/init.js";
import { setupTelegram } from "./commands/setup-telegram.js";
import { importWizardConfig } from "./commands/import-config.js";
import { status } from "./commands/status.js";
import { setVault } from "./commands/set-vault.js";

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case "init":
    void init();
    break;
  case "setup-telegram":
    void setupTelegram();
    break;
  case "import":
    if (!args[0]) { console.error("Usage: import <file>"); process.exit(1); }
    void importWizardConfig(args[0]);
    break;
  case "status":
    void status();
    break;
  case "set-vault":
    if (!args[0]) { console.error("Usage: set-vault <address>"); process.exit(1); }
    void setVault(args[0]);
    break;
  default:
    console.log("Commands: init, setup-telegram, import, status, set-vault, start");
}
