// Copies the built plugin into an Obsidian vault.
// Usage: npm run install-plugin -- "<path to vault>"
//    or: set OBSIDIAN_VAULT and run npm run install-plugin
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, "manifest.json"), "utf8"));

function fail(message) {
	console.error(`Error: ${message}`);
	process.exit(1);
}

const vaultArg = process.argv[2] ?? process.env.OBSIDIAN_VAULT;
if (!vaultArg) {
	fail('vault path is required: npm run install-plugin -- "<path to vault>"');
}

const vaultDir = path.resolve(vaultArg);
if (!fs.existsSync(path.join(vaultDir, ".obsidian"))) {
	fail(`"${vaultDir}" is not an Obsidian vault (no .obsidian folder). Open it in Obsidian once first.`);
}

for (const file of PLUGIN_FILES) {
	if (!fs.existsSync(path.join(projectDir, file))) {
		fail(`${file} not found. Run "npm run build" first.`);
	}
}

const pluginDir = path.join(vaultDir, ".obsidian", "plugins", manifest.id);
fs.mkdirSync(pluginDir, { recursive: true });

// The plugin folder may already be a link to this project (dev setup).
if (fs.realpathSync(pluginDir) === fs.realpathSync(projectDir)) {
	console.log(`${pluginDir} already links to this project, nothing to copy.`);
	process.exit(0);
}

for (const file of PLUGIN_FILES) {
	fs.copyFileSync(path.join(projectDir, file), path.join(pluginDir, file));
}

console.log(`Installed ${manifest.name} ${manifest.version} to ${pluginDir}`);
console.log("Enable it in Obsidian: Settings → Community plugins → Paranoid Tasks.");
