class AnimRotateTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;

        const subgroup = app.selectedSubgroup;
        if (!subgroup) return;

        const marker = subgroup.userData.pivotMarker;
        if (!marker) return;

        const rotSpeed = 0.005 * scale;
        const pivot = marker.position.clone();

        let didRotate = false;
const sg = this.app.selectedSubgroup;
if (!sg) return;
    
        if (this.app.Yblue){
            if (input.keys["w"]) {
                sg.rotation.y += rotSpeed;
                didRotate = true;
            }

            if (input.keys["s"]) {
                sg.rotation.y -= rotSpeed;
                didRotate = true;
            }
        }
        else{
            if (input.keys["w"]) {
                sg.rotation.x += rotSpeed;
                didRotate = true;
            }

            if (input.keys["s"]) {
                sg.rotation.x -= rotSpeed;
                didRotate = true;
            }

            if (input.keys["a"]) {
                sg.rotation.z += rotSpeed;
                didRotate = true;
            }

            if (input.keys["d"]) {
                sg.rotation.z -= rotSpeed;
                didRotate = true;
            }
        }
        if (didRotate) {
            subgroup.updateMatrixWorld(true);
            app.markSubgroupChanged(subgroup);
        }
    }
}