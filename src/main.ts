import { Plugin } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./BoardView";

export default class ParanoidTasksPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(VIEW_TYPE_BOARD, (leaf) => new BoardView(leaf));

		this.addRibbonIcon("layout-dashboard", "Open task board", () => void this.activateView());
		this.addCommand({
			id: "open-board",
			name: "Open task board",
			callback: () => void this.activateView(),
		});
	}

	private async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_BOARD)[0];
		if (existing) {
			workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_BOARD, active: true });
		workspace.revealLeaf(leaf);
	}
}
