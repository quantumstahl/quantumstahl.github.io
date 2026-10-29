import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";

// A single pooled impact flash for all targets; no per-hit render objects.
export class CombatFeedback {
  constructor(scene) {
    this.mesh = new Mesh(new SphereGeometry(.09, 6, 4), new MeshBasicMaterial({ color: 0xffe6a3, transparent: true, depthWrite: false }));
    this.mesh.visible = false; this.mesh.name = "Claw impact";
    this.remaining = 0; scene.add(this.mesh);
  }
  hit(hit) {
    this.mesh.position.copy(hit.position); this.mesh.scale.setScalar(1); this.mesh.material.opacity = 1;
    this.remaining = .12; this.mesh.visible = true;
  }
  update(delta) {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - delta);
    this.mesh.visible = this.remaining > 0;
    this.mesh.material.opacity = this.remaining / .12;
    this.mesh.scale.setScalar(1 + (1 - this.remaining / .12) * 1.5);
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
