# Paranoid-Tasks

## Установка

### 1. Что понадобится

- [Obsidian](https://obsidian.md/) — vault должен быть хотя бы раз открыт в нём (чтобы появилась папка `.obsidian`).
- [Node.js](https://nodejs.org/) версии 20 или новее (вместе с ним ставится `npm`). Проверить: `node -v`.
- [Git](https://git-scm.com/) — если скачиваете через `git clone` (можно и ZIP-архивом с GitHub).

### 2. Скачать и собрать плагин

```sh
git clone https://github.com/ParanoidMann/Paranoid-Tasks.git
cd Paranoid-Tasks
npm ci
npm run build
```

Если скачали ZIP — распакуйте его и выполните `npm ci` и `npm run build` в распакованной папке.

После сборки в папке появится `main.js`. Вместе с `manifest.json` и `styles.css` это и есть плагин.

### 3. Установить в vault

Путь к vault — это папка, которую вы выбирали при создании или открытии хранилища в Obsidian
(в ней лежит скрытая папка `.obsidian`).


```sh
npm run install-plugin -- "<путь к vault>"
```

### 4. Включить в Obsidian

1. Перезапустите Obsidian (или Ctrl+P → **Reload app without saving**).
2. **Settings → Community plugins**. Если включён Restricted mode — нажмите **Turn on community plugins**.
3. Включите **Paranoid Tasks** в списке установленных плагинов.
4. Нажмите иконку доски на левой панели — в vault появится `Tasks/Main.md`.

### Обновление

```sh
git pull
npm ci
npm run build
npm run install-plugin -- "<путь к vault>"
```

Затем перезапустите Obsidian (или выключите и включите плагин в настройках).

### Телефон / планшет

На мобильных устройствах собрать плагин нельзя. Соберите его на компьютере и перенесите три файла
(`main.js`, `manifest.json`, `styles.css`) в `<vault>/.obsidian/plugins/paranoid-tasks/` на устройстве —
вручную или через синхронизацию vault (Obsidian Sync, iCloud, Syncthing и т.п.; в Obsidian Sync должна быть включена
синхронизация «Installed community plugins»). Затем включите плагин, как в шаге 4.
