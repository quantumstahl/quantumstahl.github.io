class AniMoveTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;
        const sg = app.selectedSubgroup;

        if (!sg) return;

        const moveSpeed = 0.008 * scale;

        let moved = false;

        if (app.Yblue) {
            if (input.keys["w"]) { sg.position.y += moveSpeed; moved = true; }
            if (input.keys["s"]) { sg.position.y -= moveSpeed; moved = true; }
        } else {
            if (input.keys["w"]) { sg.position.z -= moveSpeed; moved = true; }
            if (input.keys["s"]) { sg.position.z += moveSpeed; moved = true; }
            if (input.keys["a"]) { sg.position.x -= moveSpeed; moved = true; }
            if (input.keys["d"]) { sg.position.x += moveSpeed; moved = true; }
        }

        if (moved) {
            sg.updateMatrixWorld(true);
            app.markSubgroupChanged?.(sg);
        }
    }
}