class ToolManager {
    constructor(app) {
        this.app = app;

        this.tools = {
            select: new SelectTool(app),
            move: new MoveTool(app),
            rotate: null,
            scale: null
        };

        this.current = this.tools.select;
    }

    setTool(name) {
        if (!this.tools[name]) return;

        if (this.current?.exit) this.current.exit();

        this.current = this.tools[name];

        if (this.current?.enter) this.current.enter();
    }

    update(scale) {
        if (this.current?.update) {
            this.current.update(scale);
        }
    }
}