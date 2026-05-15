class ToolManager {
    constructor(game) {
        this.game = game;

        this.tools = {
            select: new SelectTool(game),
            move: new MoveTool(game)
        };

        this.currentName = "select";
        this.current = this.tools.select;
    }

    setTool(name) {
        if (!this.tools[name]) return;

        if (this.current?.exit) this.current.exit();

        // Om du vill deselecta när man trycker Select
        if (name === "select") {
            this.game.setSelected(null);
        }

        this.currentName = name;
        this.current = this.tools[name];

        if (this.current?.enter) this.current.enter();

        this.game.editorTree?.renderToolbar?.();
    }

    update(scale) {
        this.current?.update?.(scale);
    }
}
window.ToolManager = ToolManager;