import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from "three";

// Runtime-only opt-in fixture. No editor data, collision or saved-world changes.
export class CombatTestTarget {
  constructor(scene, melee, body) {
    this.mesh = new Mesh(new BoxGeometry(.4, .5, .4), new MeshStandardMaterial({ color: 0xc68b4e }));
    this.mesh.name = "Claw test target";
    this.position = this.mesh.position;
    this.position.copy(body.position).add(new Vector3(-Math.sin(body.yaw) * .85, .3, -Math.cos(body.yaw) * .85));
    this.radius = .25; this.health = 4; this.enabled = true; this.flash = 0;
    this.unregister = melee.register(this); scene.add(this.mesh);
  }
  receiveHit({ damage, direction }) {
    this.health -= damage; this.flash = .12;
    this.position.addScaledVector(direction, .04);
    if (this.health <= 0) { this.enabled = false; this.mesh.visible = false; }
  }
  update(delta) {
    if (this.flash <= 0) return;
    this.flash = Math.max(0, this.flash - delta);
    this.mesh.material.emissive.setHex(this.flash > 0 ? 0x886633 : 0);
  }
  dispose() { this.unregister(); this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
