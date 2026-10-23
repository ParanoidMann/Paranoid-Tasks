# Paranoid Tasks

## About

Paranoid Tasks is a Kanban task board for Obsidian. All tasks live in a single Markdown note (`Tasks/Main.md` by default): each column is a section and each task is a list item, so the list stays readable and editable without the plugin.

The goal is a simple task tracker with the widest possible customization in settings: almost every feature can be tuned or turned off, so the board does only what you need.

What it can do:

- Columns you define, with drag-and-drop for tasks and columns, collapsing and task counts.
- Priorities with your own names, symbols and colors.
- Deadlines, optionally raising a task's priority as the deadline approaches.
- Recurring tasks with a checkbox that clears itself every hour, day, week, month or year (optionally at a set time).
- A linked details note for any task.
- Safe removal: removed tasks stay in the file until you clear them.
- English, Russian, German, French and Spanish interface.

A task in the task file looks like this:

```md
## Open
- [Priority: High] [Deadline: 2026-10-30] [Details: [[Report]]] Prepare the report
- [Repeat: daily 09:00] Morning exercise
```

## Installation

### From Obsidian

Once the plugin is available in the community plugin directory: **Settings → Community plugins → Browse**, search for **Paranoid Tasks**, install and enable it.

Until then (or to get updates right after release), you can install it with the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, including on mobile: add the repository `ParanoidMann/Paranoid-Tasks` in BRAT.

### From source

#### 1. Requirements

- [Obsidian](https://obsidian.md/). The vault must have been opened in it at least once (so that the `.obsidian` folder exists).
- [Node.js](https://nodejs.org/) 20 or newer (comes with `npm`). Check with `node -v`.
- [Git](https://git-scm.com/), if you download with `git clone` (a ZIP archive from GitHub also works).

#### 2. Download and build

```sh
git clone https://github.com/ParanoidMann/Paranoid-Tasks.git
cd Paranoid-Tasks
npm ci
npm run build
```

If you downloaded a ZIP, unpack it and run `npm ci` and `npm run build` in the unpacked folder.

The build creates `main.js`. Together with `manifest.json` and `styles.css`, this is the plugin.

#### 3. Install into a vault

The vault path is the folder you chose when creating or opening the vault in Obsidian (it contains the hidden `.obsidian` folder).

```sh
npm run install-plugin -- "<path to vault>"
```

This copies `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/paranoid-tasks/`. You can also copy them there by hand.

#### 4. Enable in Obsidian

1. Restart Obsidian (or Ctrl+P → **Reload app without saving**).
2. Open **Settings → Community plugins**. If Restricted mode is on, click **Turn on community plugins**.
3. Enable **Paranoid Tasks** in the list of installed plugins.
4. Click the board icon in the left ribbon. The task file `Tasks/Main.md` is created in the vault.

#### Updating

```sh
git pull
npm ci
npm run build
npm run install-plugin -- "<path to vault>"
```

Then restart Obsidian (or turn the plugin off and on in settings).

#### Phone / tablet

The plugin cannot be built on mobile devices. Build it on a computer and copy the three files (`main.js`, `manifest.json`, `styles.css`) to `<vault>/.obsidian/plugins/paranoid-tasks/` on the device, by hand or through vault sync (Obsidian Sync, iCloud, Syncthing, etc.; in Obsidian Sync, "Installed community plugins" sync must be on). Then enable the plugin as in step 4.

## License

[MIT](LICENSE)
