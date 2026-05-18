class SleepingZEffect {
    constructor(parentObj,app) {
        this.app=app;
        this.parentObj = parentObj;   // insekten

        this.timer = 0;
        this.spawnInterval = 0.9; // ny Z var 0.45 sek
        this.zs = [];
    }

    spawnZ() {
        if(this.parentObj.userData.squished)return;
        const z = createZSprite();

        // startposition ovanför insekten
     const insectPos = new THREE.Vector3();
        this.parentObj.userData.mapObject.mesh.getWorldPosition(insectPos);
        
        z.position.set(
            insectPos.x,  // lite sidled
           insectPos.y+1,  // ovanför kroppen
            insectPos.z+1
        );

        z.userData.vy = 0.35 + Math.random() * 0.15; // stiger uppåt
        z.userData.vx = (Math.random() - 0.5) * 0.05;
        z.userData.life = 0;
        z.userData.maxLife = 1.8 + Math.random() * 0.5;
        

        
        this.app.scene.add(z);
        this.zs.push(z);
    }

    update(dt) {
        this.timer += dt;

        if (this.timer >= this.spawnInterval) {
            this.timer = 0;
            this.spawnZ();
        }

        for (let i = this.zs.length - 1; i >= 0; i--) {
            const z = this.zs[i];

            z.userData.life += dt;
            const t = z.userData.life / z.userData.maxLife;

            z.position.y += z.userData.vy * dt;
            z.position.x += z.userData.vx * dt;

            // liten växning i början
            const s = 0.45 + t * 0.25;
            z.scale.set(s, s, s);

            // fade out
            z.material.opacity = 1 - t;

            if (t >= 1) {
                this.app.scene.remove(z);
                z.material.map.dispose();
                z.material.dispose();
                this.zs.splice(i, 1);
            }
        }
    }
}