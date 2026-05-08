class AniScaleTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;
        const sg = app.selectedSubgroup;

        if (!sg) return;

        const scaleSpeed = 0.01 * scale;
        let changed = false;

        if (app.Yblue) {
            if (input.keys["w"]) {
                app.scaleSubgroupKeepCenter(sg, () => {
                    sg.scale.y += scaleSpeed;
                });
                changed = true;
            }

            if (input.keys["s"]) {
                app.scaleSubgroupKeepCenter(sg, () => {
                    sg.scale.y -= scaleSpeed;
                });
                changed = true;
            }
        } else {
            if (input.keys["w"]) {
                app.scaleSubgroupKeepCenter(sg, () => {
                    sg.scale.x += scaleSpeed;
                    sg.scale.y += scaleSpeed;
                    sg.scale.z += scaleSpeed;
                });
                changed = true;
            }

            if (input.keys["s"]) {
                app.scaleSubgroupKeepCenter(sg, () => {
                    sg.scale.x -= scaleSpeed;
                    sg.scale.y -= scaleSpeed;
                    sg.scale.z -= scaleSpeed;
                });
                changed = true;
            }
        }

        if (changed) {
            sg.updateMatrixWorld(true);
        }
    }
}