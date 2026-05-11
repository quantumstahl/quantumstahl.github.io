class ToolManager {
    constructor(app) {
        this.app = app;

        this.tools = {
            select: new SelectTool(app),
            move: new MoveTool(app),
            rotate: new RotateTool(app),
            scale: new ScaleTool(app),
            uniscale: new UniformScale(app),
            group: new GroupTool(app),
            subgroup:new SubgroupTool(app),
            pivit:new PivotTool(app),
            anirot:new AnimRotateTool(app),
            selectsub:new SelectSubgroupTool(app),
            animove: new AniMoveTool(app),
            aniscale: new AniScaleTool(app),
            primselect: new PrimSelectTool(app),
            facepaint:new FacePaintTool(app)
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